import { MapboxOverlay as DeckOverlay, MapboxOverlayProps } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, NavigationControl, useControl } from 'react-map-gl/maplibre';
import type * as arrow from 'apache-arrow';

import { AGENT_MODE_TRIP_COLORS, INITIAL_VIEW_STATE, MAP_MIN_ZOOM, MAP_MAX_ZOOM, MODE_BIT_LABELS } from '../constants/map';
import { LAYER_IDS } from '../constants/layers';
import { ArrowTripsLayer } from './custom_layer/arrowTripsLayer/ArrowTripsLayer';
import { ArrowLoader, ArrowWorkerLoader } from '@loaders.gl/arrow';
import { useMapStore } from '../zustand/useMapStore';
import { useShallow } from '@sqlrooms/room-shell';
import { useHeatmapLayer } from '../hooks/useHeatmapLayer';
import { useODArcLayer } from '../hooks/useODArcLayer';
import { usePointsLayer, ZOOM_THRESHOLD } from '../hooks/usePointsLayer';
import { useFacilityPointsLayer } from '../hooks/useFacilityPointsLayer';
import { useStopCountsLayer } from '../hooks/useStopCountsLayer';
import { useShelterCapacityLayer } from '../hooks/useShelterCapacityLayer';


// CARTO 的 dark-matter-gl-style 底層 OSM 資料官方文件寫最慢一年才重建一次（快則 3–6 個月），
// 淡江大橋這種新完工的建設即使 OSM 上已經有人畫了，也可能好幾個月看不到——改用 MapTiler
// 的 dataviz-dark（專為深色資料視覺化設計），資料每週重建一次，新鮮度好很多。
// 沒設定 VITE_MAPTILER_API_KEY 時 fallback 回 CARTO，避免沒申請 key 的人本機起不來。
const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY as string | undefined;
const MAP_STYLE = MAPTILER_API_KEY
  ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_API_KEY}`
  : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

if (!MAPTILER_API_KEY) {
  console.warn(
    '[MapView] VITE_MAPTILER_API_KEY 未設定，底圖 fallback 回 CARTO dark-matter（資料較舊）。' +
    '到 https://cloud.maptiler.com/account/keys/ 申請免費 key 後填進 .env 即可換成每週更新的 MapTiler 底圖。'
  );
}

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl(() => new DeckOverlay(props));
  overlay.setProps(props);
  return null;
}

// 模組層級變數（不是 React state）：MainView 在切換情境時，因為 useSql 重新查詢會短暫
// isLoading，把 <MapView> 整個換成 <SpinnerPane>，等新資料回來又重新掛載——react-map-gl
// 的 initialViewState 只在掛載當下讀一次，MapView 重新掛載就會用回這個常數，鏡頭跟著被重置。
// 用模組層級變數記住「使用者最後停在哪」，重新掛載時讀這個而不是永遠讀初始值，元件重新
// 掛載不會清掉模組變數（只有整頁重新整理才會）。
let lastViewState = INITIAL_VIEW_STATE;

export const MapView: FC<{ arrowTable: arrow.Table }> = ({ arrowTable }) => {
  const { time, setTime, isPlaying, selectedModes, tripsVisible, timeRange } = useMapStore(
    useShallow((state) => ({
      time: state.time,
      setTime: state.setTime,
      isPlaying: state.isPlaying,
      selectedModes: state.selectedModes,
      tripsVisible: state.visibleLayers[LAYER_IDS.TRIPS] ?? true,
      timeRange: state.timeRange,
    }))
  );

  const [currentZoom, setCurrentZoom] = useState(lastViewState.zoom);
  const handleMove = useCallback((e: { viewState: typeof INITIAL_VIEW_STATE }) => {
    setCurrentZoom(e.viewState.zoom);
    lastViewState = e.viewState;
  }, []);
  // Stations/Shelters 的 hover tooltip：依 layer id 分辨物件形狀，顯示編號/名稱/容量
  const getTooltip = useCallback((info: any) => {
    const obj = info?.object;
    if (!obj) return null;
    if (info.layer?.id === 'facility-stations') {
      const kindLabel = obj.kind === 'bus' ? '公車站' : '捷運站';
      return { text: `${kindLabel}\n編號: ${obj.id}\n${obj.name ?? ''}` };
    }
    if (info.layer?.id === 'facility-shelters') {
      return { text: `避難所\n編號: ${obj.id}\n${obj.name ?? ''}\n容量: ${obj.capacity ?? '—'} 人` };
    }
    if (info.layer?.id === 'stop-counts-layer') {
      const kindLabel = obj.mode === 8 ? '公車站' : '捷運站';
      return { text: `${kindLabel}\n候車人數: ${obj.waiting}` };
    }
    if (info.layer?.id === 'shelter-capacity-layer') {
      const pct = Math.round((obj.loadRatio ?? 0) * 100);
      return {
        text: `避難所\n編號: ${obj.id}\n${obj.name ?? ''}\n收容: ${obj.currentCount} / ${obj.capacity ?? '—'} 人\n壅擠度: ${pct}%（${obj.status}）`,
      };
    }
    return null;
  }, []);

  // 加這段
  const [debouncedTimeRange, setDebouncedTimeRange] = useState<[number, number]>(timeRange);
  useEffect(() => {
    if (isPlaying) return; // 播放中凍結
    const id = setTimeout(() => setDebouncedTimeRange(timeRange), 300);
    return () => clearTimeout(id);
  }, [timeRange, isPlaying]);

  // 同份 arrowTable 給 heatmap / points;未來若資料來源分流,改在 hook 內 useSql。
  const heatmapLayers = useHeatmapLayer(arrowTable, debouncedTimeRange);
  const odArcLayer = useODArcLayer();
  const { layers: pointsLayers, meta: pointsMeta } = usePointsLayer(arrowTable, currentZoom);
  const pointsMetaRef = useRef(pointsMeta);
  pointsMetaRef.current = pointsMeta;

  // Points 圖層用 binary attributes，沒有 per-instance 物件可供 picking（obj 一定是
  // undefined），要靠 info.index 去查 usePointsLayer 算好的 meta——meta 是同一個 array
  // 參照每幀原地更新，這裡讀到的永遠是當下畫面對應的資料，不會有 stale closure 問題。
  const getPointTooltip = useCallback((info: any) => {
    if (info.layer?.id !== 'trips-point') return null;
    const m = pointsMetaRef.current[info.index];
    if (!m || !m.visible) return null;
    const modeLabel = MODE_BIT_LABELS[m.mode] ?? '未知';
    const speedText = m.segDurationSec > 0 ? `${m.speedKmh.toFixed(1)} km/h` : '—';
    return {
      text: `路徑編號: ${info.index}\n運具: ${modeLabel}\n目前路段時速: ${speedText}${m.statusLabel ? `（${m.statusLabel}）` : ''}`,
    };
  }, []);

  const combinedGetTooltip = useCallback(
    (info: any) => getTooltip(info) ?? getPointTooltip(info),
    [getTooltip, getPointTooltip]
  );

  const facilityLayers = useFacilityPointsLayer();
  const stopCountsLayers = useStopCountsLayer(currentZoom);
  const shelterCapacityLayers = useShelterCapacityLayer();
  
  // 🌟 修復時間凍結：完美的 requestAnimationFrame 迴圈
  useEffect(() => {
    if (!isPlaying) return;

    let lastTimestamp = performance.now();
    let animationFrameId: number;

    const animate = (currentTimestamp: number) => {
      const deltaSec = (currentTimestamp - lastTimestamp) / 1000;
      lastTimestamp = currentTimestamp;

      // 🌟 Zustand 超能力：直接用 getState() 拿取最新數值，不用擔心閉包陷阱！
      const state = useMapStore.getState();
      const currentScale = state.timeScale;
      const [startTime, endTime] = state.timeRange;
      const [displayStart, displayEnd] = state.displayTimeRange;

      const windowWidth = endTime - startTime; // 保持目前的區間寬度 (例如 30 分鐘)
      const moveStep = deltaSec * currentScale;

      let nextEndTime = endTime + moveStep;
      let nextStartTime = startTime + moveStep;

      // 🌟 邊界處理：超過目前情境的資料範圍（displayTimeRange，不是寫死的 86400）就重置回起點。
      // 之前寫死 86400：shelter_in_place 資料範圍才約 1.5 小時，超過範圍後全部圖層會消失，
      // 卻要一路空播到 24:00:00 才重置；mass_evacuation 資料範圍長達 72 小時，反而不到一天
      // 就提早被切斷，後面 48 小時的資料永遠播不到。
      if (nextEndTime > displayEnd) {
        nextStartTime = displayStart;
        nextEndTime = displayStart + windowWidth;
      }

      // 🚀 同步更新兩個關鍵狀態
      // 1. 更新地圖光束時間
      setTime(nextEndTime);
      // 2. 更新 TimeLine 上的藍色遮罩與把手位置，這樣把手才會跟著跑！
      useMapStore.getState().setTimeRange([nextStartTime, nextEndTime]);

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, setTime]);

  const layers: any[] = [];

  const computedBitmask = useMemo(() => {
    return selectedModes.reduce((acc, modeBit) => acc | modeBit, 0);
  }, [selectedModes]);

  // 順序:heatmap → od-arc → facilities → points → stop-counts → shelter-capacity → trips（後 push 的畫在上面）
  // ⚠ points 刻意排在 stop-counts/shelter-capacity 之前：代理人剛好停在站點/避難所座標上時，
  // 讓候車人潮泡泡/飽和率圈蓋在 points 上面（泡泡本來就比較大、代表匯總資訊，蓋掉底下單點
  // 才合理），不然兩個顏色相近、不透明度都調高的圓疊在一起，會變成一個圓「缺一角」的詭異形狀
  layers.push(...heatmapLayers);
  if (odArcLayer) layers.push(odArcLayer);
  layers.push(...facilityLayers);
  layers.push(...pointsLayers);
  layers.push(...stopCountsLayers);
  layers.push(...shelterCapacityLayers);

  if (arrowTable && tripsVisible && currentZoom <= ZOOM_THRESHOLD) {
    layers.push(
      new ArrowTripsLayer({
        id: 'trips-layer',
        data: arrowTable, 
        loaders: [ArrowLoader, ArrowWorkerLoader],
        loadOptions: { arrow: { shape: "arrow-table" } },
        
        currentTime: time, 
        trailLength: 600,
        
        colorMap: AGENT_MODE_TRIP_COLORS.flat().map((c) => c / 255),
        filterBitMask: [computedBitmask], 
        
        widthMinPixels: 2,
        getWidth: 4,
        faded: true,
        parameters: {
          depthTest: false,
          blend: true,
          blendColorSrcFactor: 'src-alpha',
          blendColorDstFactor: 'one',
          blendColorOperation: 'add',
        },
      })
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* 為了方便除錯，暫時保留左上角的時鐘/zoom，之後可以拿掉 */}
      <div className="absolute top-5 left-5 z-10 bg-black/80 text-white p-3 rounded font-mono">
        <div>Time: {Math.floor(time)}</div>
        <div>Zoom: {currentZoom.toFixed(2)}</div>
      </div>

      <Map
        initialViewState={lastViewState}
        mapStyle={MAP_STYLE}
        onMove={handleMove}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
      >
        <DeckGLOverlay layers={layers} getTooltip={combinedGetTooltip} />
        <NavigationControl position="top-left" />
      </Map>
    </div>
  );
};
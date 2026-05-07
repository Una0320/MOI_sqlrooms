import { MapboxOverlay as DeckOverlay, MapboxOverlayProps } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FC, useEffect, useMemo, useRef } from 'react';
import { Map, NavigationControl, useControl } from 'react-map-gl/maplibre';

import { AGENT_MODE_TRIP_COLORS, INITIAL_VIEW_STATE } from '../constants/map';
import { ArrowTripsLayer } from './custom_layer/arrowTripsLayer/ArrowTripsLayer';
import { ArrowLoader, ArrowWorkerLoader } from '@loaders.gl/arrow';
import { useMapStore } from '../zustand/useMapStore';
import { useShallow } from '@sqlrooms/room-shell';


const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl(() => new DeckOverlay(props));
  overlay.setProps(props);
  return null;
}

export const MapView: FC = () => {
  const { time, setTime, isPlaying, selectedModes } = useMapStore(
    useShallow((state) => ({
      time: state.time,
      setTime: state.setTime,
      isPlaying: state.isPlaying,
      selectedModes: state.selectedModes,
    }))
  );
  
  // 🛠️ 修復 Error 2554: useRef 必須給予初始值 0 或 null
  const animationFrameRef = useRef<number>(0); 

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
      
      const windowWidth = endTime - startTime; // 保持目前的區間寬度 (例如 30 分鐘)
      const moveStep = deltaSec * currentScale;

      let nextEndTime = endTime + moveStep;
      let nextStartTime = startTime + moveStep;

      // 🌟 邊界處理：如果超過一整天，重置回起點
      if (nextEndTime > 86400) {
        nextStartTime = 0;
        nextEndTime = windowWidth;
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

  const layers = [];
  
  const computedBitmask = useMemo(() => {
    return selectedModes.reduce((acc, modeBit) => acc | modeBit, 0);
  }, [selectedModes]);

  // 🌟 安全地從 window 取回資料，這能完美避開所有 HMR 與 Store Proxy 的報錯
  const arrowTable = (window as any).globalArrowTable;

  if (arrowTable) {
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
      {/* 為了方便除錯，暫時保留左上角的時鐘，之後可以拿掉 */}
      <div className="absolute top-5 left-5 z-10 bg-black/80 text-white p-3 rounded font-mono">
        Time: {Math.floor(time)}
      </div>

      <Map initialViewState={INITIAL_VIEW_STATE} mapStyle={MAP_STYLE}>
        <DeckGLOverlay layers={layers} />
        <NavigationControl position="top-left" />
      </Map>
    </div>
  );
};
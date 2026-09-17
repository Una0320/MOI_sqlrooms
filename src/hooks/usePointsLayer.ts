import { useMemo, useRef } from 'react';
import * as arrow from 'apache-arrow';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { AGENT_MODE_TRIP_COLORS } from '@/constants/map';

const LAYER_ID = 'trips-point';
// zoom > 此值（拉近）才顯示點位；zoom ≤ 此值時由 TripsLayer 尾巴呈現
export const ZOOM_THRESHOLD = 11;
// 高不透明度，獨立於 AGENT_MODE_TRIP_COLORS 的 alpha（見下方賦值處的說明）
const POINTS_ALPHA = 230;
// 經緯度差轉公尺的粗略係數（不需要精準，只是抓量級，算 tooltip 顯示的時速用）
const DEG_TO_METERS = 111000;

export type PointMeta = {
  visible: boolean;
  mode: number;
  speedKmh: number;
  segDurationSec: number;
  statusLabel: string;
};

type AgentCache = {
  pathFlat: number[];   // 正規化後永遠是 flat: [x0,y0,x1,y1,...]
  timestamps: number[];
  modes: number[];      // 可以是 per-segment 或 per-trip 單一值
};

// timestamps 對每個 agent 是遞增排序，二分搜尋找出 time 落在哪個 segment：
// 回傳 j 使得 timestamps[j] <= time <= timestamps[j+1]。
// 取代原本「每幀都從 0 開始線性掃描」的作法，時間複雜度從 O(numPoints) 降到 O(log numPoints)，
// 且不受時間倒退（拖曳/循環重播）影響，不需要跨幀快取 index。
const findSegmentIndex = (timestamps: number[], time: number): number => {
  let lo = 0;
  let hi = timestamps.length - 2;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timestamps[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export const usePointsLayer = (
  arrowTable: arrow.Table | undefined,
  currentZoom: number,
) => {
  const { time, selectedModes, visible } = useMapStore(
    useShallow((s) => ({
      time: s.time,
      selectedModes: s.selectedModes,
      visible: s.visibleLayers[LAYER_IDS.POINTS] ?? true,
    }))
  );

  const memoryRef = useRef<{
    sourceData: arrow.Table;
    agents: AgentCache[];
    positions: Float32Array;
    colors: Uint8Array;
    radii: Float32Array;
    meta: PointMeta[];
    numInstances: number;
  } | null>(null);

  return useMemo(() => {
    if (!arrowTable || !visible || currentZoom <= ZOOM_THRESHOLD) {
      return { layers: [], meta: [] as PointMeta[] };
    }

    // arrowTable 換掉時才重建快取，避免每幀 toArray()
    if (memoryRef.current?.sourceData !== arrowTable) {
      const rows = arrowTable.toArray();
      const agents: AgentCache[] = rows.map((row: any) => {
        // paths: List<FixedSizeList<2,Float32>> → toJSON() 回傳 [[x0,y0],...] 或已是 flat
        const rawPaths = row.paths?.toJSON ? row.paths.toJSON() : Array.from(row.paths ?? []);
        const isFlat = rawPaths.length > 0 && typeof rawPaths[0] === 'number';
        const pathFlat: number[] = isFlat
          ? Array.from(rawPaths as number[])
          : (rawPaths as any[]).flatMap((pt: any) => [Number(pt[0]), Number(pt[1])]);

        const rawTs = row.timestamps?.toJSON ? row.timestamps.toJSON() : Array.from(row.timestamps ?? []);
        const rawModes = row.modes?.toJSON ? row.modes.toJSON() : Array.from(row.modes ?? []);

        return {
          pathFlat,
          timestamps: (rawTs as any[]).map(Number),
          modes: (rawModes as any[]).map(Number),
        };
      });

      memoryRef.current = {
        sourceData: arrowTable,
        agents,
        positions: new Float32Array(rows.length * 3),
        colors: new Uint8Array(rows.length * 4),
        radii: new Float32Array(rows.length),
        // 物件池：每幀直接改內容，不重新配置，避免 20000+ instance 每幀 GC
        meta: Array.from({ length: rows.length }, () => ({
          visible: false,
          mode: 0,
          speedKmh: 0,
          segDurationSec: 0,
          statusLabel: '',
        })),
        numInstances: rows.length,
      };
    }

    const { agents, positions, colors, radii, meta, numInstances } = memoryRef.current!;
    const dynamicRadius = Math.min(8, Math.max(2, currentZoom - 8));

    for (let i = 0; i < numInstances; i++) {
      const { pathFlat, timestamps, modes } = agents[i];
      const numPoints = timestamps.length;
      const m = meta[i];

      if (!pathFlat.length || numPoints === 0) {
        colors[i * 4 + 3] = 0;
        radii[i] = 0;
        m.visible = false;
        continue;
      }

      const tStart = timestamps[0];
      const tEnd = timestamps[numPoints - 1];

      if (numPoints < 2 || time < tStart || time > tEnd) {
        colors[i * 4 + 3] = 0;
        radii[i] = 0;
        m.visible = false;
        continue;
      }

      const j = findSegmentIndex(timestamps, time);
      const t1 = timestamps[j];
      const t2 = timestamps[j + 1];

      // modes 可能是 per-segment（長度 = numPoints-1）或 per-trip（長度 1）
      const currentMode = modes.length > 1 ? modes[j] : (modes[0] ?? 1);

      if (!selectedModes.includes(currentMode)) {
        colors[i * 4 + 3] = 0;
        radii[i] = 0;
        m.visible = false;
        continue;
      }

      const p1x = pathFlat[j * 2];
      const p1y = pathFlat[j * 2 + 1];
      const p2x = pathFlat[(j + 1) * 2];
      const p2y = pathFlat[(j + 1) * 2 + 1];

      // 塞車、等車、長時間停放都是模擬裡真實會發生的狀態，一律照舊顯示、不隱藏——
      // 要看出「哪一段路徑塞住/龜速」改用 tooltip（見下方 meta），不是把點藏起來。
      const ratio = t2 > t1 ? (time - t1) / (t2 - t1) : 0;
      positions[i * 3]     = p1x + (p2x - p1x) * ratio;
      positions[i * 3 + 1] = p1y + (p2y - p1y) * ratio;
      positions[i * 3 + 2] = 0;

      const colorIndex = Math.floor(Math.log2(currentMode));
      const modeColor = AGENT_MODE_TRIP_COLORS[colorIndex] ?? [255, 255, 255, 200];
      colors[i * 4]     = modeColor[0];
      colors[i * 4 + 1] = modeColor[1];
      colors[i * 4 + 2] = modeColor[2];
      // 疊加式混色（additive blend，見下方 parameters）是刻意保留的——密度視覺化需求：
      // 多個代理人重疊在同一位置時要越疊越亮，才能一眼看出哪裡人潮密集。
      // 但 AGENT_MODE_TRIP_COLORS 自帶的 alpha（150）是為 Trips/Heatmap 那種本來就會大量
      // 重疊的軌跡調的；Points 圖層很多時候只有「單一」代理人停在原地，沒有東西可疊加，
      // alpha 150 在深色底圖上單獨看會太暗，容易被誤認成黑點——這裡把單點的基礎 alpha
      // 拉高，讓「只有一個點」時也夠亮，重疊變密集時疊加混色依然會繼續往上疊更亮。
      colors[i * 4 + 3] = POINTS_ALPHA;
      radii[i] = dynamicRadius;

      // tooltip 用：這段路的即時時速，用來判斷是不是塞車/龜速，不影響畫面顯示
      const segDurationSec = t2 - t1;
      const segDistMeters = Math.hypot(p2x - p1x, p2y - p1y) * DEG_TO_METERS;
      const speedKmh = segDurationSec > 0 ? (segDistMeters / segDurationSec) * 3.6 : 0;

      let statusLabel = '';
      if (segDurationSec > 0) {
        if (speedKmh < 1) statusLabel = '幾乎靜止（塞車/等待中）';
        else if (speedKmh < 5) statusLabel = '緩慢移動';
      }

      m.visible = true;
      m.mode = currentMode;
      m.speedKmh = speedKmh;
      m.segDurationSec = segDurationSec;
      m.statusLabel = statusLabel;
    }

    return {
      layers: [
        new ScatterplotLayer({
          id: LAYER_ID,
          data: {
            length: numInstances,
            attributes: {
              getPosition: { value: new Float32Array(positions), size: 3 },
              getFillColor: { value: new Uint8Array(colors), size: 4 },
              // 半徑逐點獨立（不再是全體共用同一個數值）：不可見的 agent（不在自己的時間
              // 範圍內、或座標根本還沒被寫入過）半徑直接是 0，這樣它停在原地（甚至是
              // Float32Array 預設值 0,0 的原點）的殘留座標就不會再佔著一塊可以被 hover
              // 命中的隱形範圍——之前只清透明度、沒清半徑，才會出現「看不到又能被
              // pick 到」的幽靈點，尤其容易疊在很多路徑都會經過的路口。
              getRadius: { value: new Float32Array(radii), size: 1 },
            },
          },
          radiusUnits: 'pixels',
          pickable: true,
          // 疊加式混色（additive）：主管要的密度視覺化效果，多個代理人疊在同一點時會越疊越亮。
          // 單點太暗的問題改用上面調高的 alpha 解決，不動這裡的混色模式。
          parameters: {
            depthTest: false,
            blend: true,
            blendColorSrcFactor: 'src-alpha' as const,
            blendColorDstFactor: 'one' as const,
            blendColorOperation: 'add' as const,
          },
        } as any),
      ],
      meta,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrowTable, visible, currentZoom, time, selectedModes]);
};

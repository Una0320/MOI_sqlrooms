// 集中管理畫面上 deck.gl layer 的識別碼與顯示名稱;
// LayerPanel 顯示這些 entry,Zustand visibleLayers 用這些 id 當 key。

import type { FileSet } from './data';

export const LAYER_IDS = {
  TRIPS: 'trips',
  ROAD_SERVICE: 'road-service',
  HEATMAP: 'heatmap',
  OD_ARC: 'od-arc',
  STATIONS: 'stations',
  SHELTERS: 'shelters',
  STOP_COUNTS: 'stop-counts',
  SHELTER_CAPACITY: 'shelter-capacity',
} as const;

export type LayerId = (typeof LAYER_IDS)[keyof typeof LAYER_IDS];

export type LayerConfig = {
  id: LayerId;
  title: string;
  defaultVisible: boolean;
  // 面板文字顏色，跟地圖上這個圖層的點位顏色對應（見 constants/map.ts）；沒給就用預設白/灰
  color?: [number, number, number];
  // 這個圖層依賴 manifest 裡的哪個 url（見 constants/data.ts 的 FileSet）。
  // 目前組合該 url 是 null → 面板上 disabled 並提示「此組合無資料」（不隱藏）。
  requires: keyof FileSet;
};

export const LAYER_CONFIG: readonly LayerConfig[] = [
  { id: LAYER_IDS.TRIPS, title: 'Trips · 移動軌跡', defaultVisible: true, requires: 'dataUrl' },
  { id: LAYER_IDS.ROAD_SERVICE, title: 'Road Service · 道路服務水準', defaultVisible: false, requires: 'roadServiceUrl' },
  { id: LAYER_IDS.HEATMAP, title: 'Heatmap · 路徑流量', defaultVisible: false, requires: 'dataUrl' },
  { id: LAYER_IDS.OD_ARC, title: 'OD Arc · 起迄弧線', defaultVisible: false, requires: 'odDataUrl' },
  { id: LAYER_IDS.STATIONS, title: 'Stations · 公車/捷運站', defaultVisible: true, color: [255, 255, 255], requires: 'busStopsUrl' },
  { id: LAYER_IDS.SHELTERS, title: 'Shelters · 避難所', defaultVisible: true, color: [236, 72, 153], requires: 'sheltersUrl' },
  { id: LAYER_IDS.STOP_COUNTS, title: 'Stop Counts · 站點候車人潮', defaultVisible: false, requires: 'stopCountsUrl' },
  { id: LAYER_IDS.SHELTER_CAPACITY, title: 'Shelter Capacity · 避難所飽和率', defaultVisible: false, requires: 'shelterCapacityUrl' },
];

export const INITIAL_VISIBLE_LAYERS: Record<LayerId, boolean> = LAYER_CONFIG.reduce(
  (acc, l) => ({ ...acc, [l.id]: l.defaultVisible }),
  {} as Record<LayerId, boolean>,
);

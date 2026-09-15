// 集中管理畫面上 deck.gl layer 的識別碼與顯示名稱;
// LayerPanel 顯示這些 entry,Zustand visibleLayers 用這些 id 當 key。

import type { ScenarioType } from './data';

export const LAYER_IDS = {
  TRIPS: 'trips',
  HEATMAP: 'heatmap',
  OD_ARC: 'od-arc',
  POINTS: 'points',
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
  // 只在特定情境類型才有意義（見 ScenarioSwitcher）；沒給就兩種情境都顯示
  scenario?: ScenarioType;
};

export const LAYER_CONFIG: readonly LayerConfig[] = [
  { id: LAYER_IDS.TRIPS, title: 'Trips · 移動軌跡', defaultVisible: true },
  { id: LAYER_IDS.HEATMAP, title: 'Heatmap · 路徑密度', defaultVisible: false },
  { id: LAYER_IDS.OD_ARC, title: 'OD Arc · 起迄弧線', defaultVisible: false },
  { id: LAYER_IDS.POINTS, title: 'Points · 位置點', defaultVisible: true },
  { id: LAYER_IDS.STATIONS, title: 'Stations · 公車/捷運站', defaultVisible: true, color: [255, 255, 255], scenario: 'mass_evacuation' },
  { id: LAYER_IDS.SHELTERS, title: 'Shelters · 避難所', defaultVisible: true, color: [236, 72, 153], scenario: 'shelter_in_place' },
  { id: LAYER_IDS.STOP_COUNTS, title: 'Stop Counts · 站點候車人潮', defaultVisible: false, scenario: 'mass_evacuation' },
  { id: LAYER_IDS.SHELTER_CAPACITY, title: 'Shelter Capacity · 避難所飽和率', defaultVisible: false, scenario: 'shelter_in_place' },
];

export const INITIAL_VISIBLE_LAYERS: Record<LayerId, boolean> = LAYER_CONFIG.reduce(
  (acc, l) => ({ ...acc, [l.id]: l.defaultVisible }),
  {} as Record<LayerId, boolean>,
);

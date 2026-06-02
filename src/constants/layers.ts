// 集中管理畫面上 deck.gl layer 的識別碼與顯示名稱;
// LayerPanel 顯示這些 entry,Zustand visibleLayers 用這些 id 當 key。

export const LAYER_IDS = {
  TRIPS: 'trips',
  HEATMAP: 'heatmap',
  OD_ARC: 'od-arc',
  POINTS: 'points',
} as const;

export type LayerId = (typeof LAYER_IDS)[keyof typeof LAYER_IDS];

export type LayerConfig = {
  id: LayerId;
  title: string;
  defaultVisible: boolean;
};

export const LAYER_CONFIG: readonly LayerConfig[] = [
  { id: LAYER_IDS.TRIPS, title: 'Trips · 移動軌跡', defaultVisible: true },
  { id: LAYER_IDS.HEATMAP, title: 'Heatmap · 路徑密度', defaultVisible: false },
  { id: LAYER_IDS.OD_ARC, title: 'OD Arc · 起迄弧線', defaultVisible: false },
  { id: LAYER_IDS.POINTS, title: 'Points · 位置點', defaultVisible: true },
];

export const INITIAL_VISIBLE_LAYERS: Record<LayerId, boolean> = LAYER_CONFIG.reduce(
  (acc, l) => ({ ...acc, [l.id]: l.defaultVisible }),
  {} as Record<LayerId, boolean>,
);

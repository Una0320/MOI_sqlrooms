import { create } from 'zustand';
import { INITIAL_SELETED_MOBILITY_MODES_BITS } from '../constants/map';
import { INITIAL_VISIBLE_LAYERS, type LayerId } from '../constants/layers';
import type { ScenarioType } from '../constants/data';
/**
變數名稱,     代表意義,             範例 (秒),        視覺表現
ViewRange,   數據的絕對邊界,        "[0, 86400]",    整個時間軸的總長度
DisplayRange,使用者選定的觀測視窗,   "[7200, 43200]", 直方圖被放大的範圍
TimeRange,   當前播放的 active 區間,"[12000, 13800]",藍色遮罩與兩個把手的位置
Time,        地圖光束的當前時間,      13800,          通常等於 TimeRange[1]
 */
interface MapState {
  time: number;
  timeRange: [number, number];
  displayTimeRange: [number, number];
  viewTimeRange: [number, number];
  isPlaying: boolean;
  timeScale: number;
  selectedModes: number[];
  visibleLayers: Record<LayerId, boolean>;
  scenarioType: ScenarioType;

  setTime: (t: number) => void;
  setTimeRange: (range: [number, number]) => void;
  togglePlay: () => void;
  setTimeScale: (scale: number) => void;
  toggleMode: (modeBit: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setDisplayTimeRange: (range: [number, number]) => void;
  setViewTimeRange: (range: [number, number]) => void;
  toggleLayer: (id: LayerId) => void;
  setScenarioType: (type: ScenarioType) => void;
}

export const useMapStore = create<MapState>((set) => ({
  time: 0, // 初始時間
  timeRange: [0, 1800], // 初始播放區間，預設前 30 分鐘
  displayTimeRange: [0, 86400],
  viewTimeRange: [0, 86400],
  isPlaying: false,
  timeScale: 30, // 預設 30 倍速
  selectedModes: INITIAL_SELETED_MOBILITY_MODES_BITS,
  visibleLayers: INITIAL_VISIBLE_LAYERS,
  scenarioType: 'mass_evacuation', // 預設對齊現有的 pt10 設定

  setTime: (t) => set({ time: t }),
  setTimeRange: (range) => set({ timeRange: range }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setTimeScale: (scale) => set({ timeScale: scale }),
  toggleMode: (modeBit) => set((state) => {
    const isSelected = state.selectedModes.includes(modeBit);
    return {
      selectedModes: isSelected
        ? state.selectedModes.filter(m => m !== modeBit)
        : [...state.selectedModes, modeBit]
    };
  }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setDisplayTimeRange: (range) => set({ displayTimeRange: range }),
  setViewTimeRange: (range) => set({ viewTimeRange: range }),
  toggleLayer: (id) => set((state) => ({
    visibleLayers: { ...state.visibleLayers, [id]: !state.visibleLayers[id] },
  })),
  // 兩種情境的時間軸長度差很多（pt* 70 小時、evac_ratio* 1.5 小時），切換時把播放狀態
  // 重置回起點，不然可能卡在一個對新情境無效的時間點，畫面看起來像壞掉。
  setScenarioType: (type) => set({
    scenarioType: type,
    time: 0,
    timeRange: [0, 1800],
    isPlaying: false,
  }),
}));
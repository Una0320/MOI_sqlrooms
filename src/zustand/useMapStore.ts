import { create } from 'zustand';
import { INITIAL_SELETED_MOBILITY_MODES_BITS } from '../constants/map';
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
  
  setTime: (t: number) => void;
  setTimeRange: (range: [number, number]) => void;
  togglePlay: () => void;
  setTimeScale: (scale: number) => void;
  toggleMode: (modeBit: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setDisplayTimeRange: (range: [number, number]) => void;
  setViewTimeRange: (range: [number, number]) => void;
}

export const useMapStore = create<MapState>((set) => ({
  time: 0, // 初始時間
  timeRange: [0, 1800], // 初始播放區間，預設前 30 分鐘
  displayTimeRange: [0, 86400],
  viewTimeRange: [0, 86400],
  isPlaying: false,
  timeScale: 30, // 預設 30 倍速
  selectedModes: INITIAL_SELETED_MOBILITY_MODES_BITS,

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
  setViewTimeRange: (range) => set({ viewTimeRange: range })
}));
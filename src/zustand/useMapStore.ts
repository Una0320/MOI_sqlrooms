import { create } from 'zustand';
import { INITIAL_SELETED_MOBILITY_MODES_BITS } from '../constants/map';
import { INITIAL_VISIBLE_LAYERS, type LayerId } from '../constants/layers';
import { availableRatios, type Ratio, type ScenarioType } from '../constants/data';
/**
變數名稱,     代表意義,             範例 (秒),        視覺表現
ViewRange,   數據的絕對邊界,        "[0, 86400]",    整個時間軸的總長度
DisplayRange,使用者選定的觀測視窗,   "[7200, 43200]", 直方圖被放大的範圍
TimeRange,   當前播放的 active 區間,"[12000, 13800]",藍色遮罩與兩個把手的位置
Time,        地圖光束的當前時間,      13800,          通常等於 TimeRange[1]
 */
// 播放視窗預設寬度（秒）：15 分鐘。切情境 / 載入資料時都回到這個寬度。
export const DEFAULT_TIME_WINDOW_SEC = 900;

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
  ratio: Ratio;
  // 路網管制開關：切情境 / 切 ratio 時保持不變（見 setScenarioType）
  networkControl: boolean;

  setTime: (t: number) => void;
  setTimeRange: (range: [number, number]) => void;
  togglePlay: () => void;
  setTimeScale: (scale: number) => void;
  setTimeWindow: (sec: number) => void;
  toggleMode: (modeBit: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setDisplayTimeRange: (range: [number, number]) => void;
  setViewTimeRange: (range: [number, number]) => void;
  toggleLayer: (id: LayerId) => void;
  setScenarioType: (type: ScenarioType) => void;
  setRatio: (ratio: Ratio) => void;
  setNetworkControl: (on: boolean) => void;
}

const RESET_PLAYBACK = {
  time: 0,
  timeRange: [0, DEFAULT_TIME_WINDOW_SEC] as [number, number],
  isPlaying: false,
};

export const useMapStore = create<MapState>((set) => ({
  time: 0, // 初始時間
  timeRange: [0, DEFAULT_TIME_WINDOW_SEC], // 初始播放區間，預設前 15 分鐘
  displayTimeRange: [0, 86400],
  viewTimeRange: [0, 86400],
  isPlaying: false,
  timeScale: 30, // 預設 30 倍速
  selectedModes: INITIAL_SELETED_MOBILITY_MODES_BITS,
  visibleLayers: INITIAL_VISIBLE_LAYERS,
  scenarioType: 'mass_evacuation',
  ratio: 20, // 大規模撤離預設 pt20（road_service 目前只有 pt20）；ratio 目前沒有 UI，但 store 與 resolveFiles 保留
  networkControl: false,

  setTime: (t) => set({ time: t }),
  setTimeRange: (range) => set({ timeRange: range }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setTimeScale: (scale) => set({ timeScale: scale }),
  // 保持起點不動，把視窗終點改成 起點 + sec（不超過資料範圍），地圖光束時間跟著終點
  setTimeWindow: (sec) => set((state) => {
    const start = state.timeRange[0];
    const end = Math.min(start + sec, state.displayTimeRange[1]);
    return { timeRange: [start, end], time: end };
  }),
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
  // 不同情境 / ratio 的時間軸長度差很多（pt* 約 70 小時、evac_ratio10 約 1.5 小時、evac_ratio40 約 11.8 小時），
  // 切換時把播放狀態重置回起點，不然可能卡在一個對新資料無效的時間點，畫面看起來像壞掉。
  // networkControl 刻意不在這裡動：切情境時開關狀態保持。
  setScenarioType: (type) => set((state) => {
    const control = state.networkControl ? 'network_control' : 'none';
    // 目前的 ratio 在新情境沒資料時，退到該情境第一個有資料的 ratio（都沒有就維持原值，由 UI disabled）
    const ratios = availableRatios(type, control);
    const ratio = ratios.includes(state.ratio) ? state.ratio : (ratios[0] ?? state.ratio);
    return { scenarioType: type, ratio, ...RESET_PLAYBACK };
  }),
  setRatio: (ratio) => set({ ratio, ...RESET_PLAYBACK }),
  setNetworkControl: (on) => set({ networkControl: on, ...RESET_PLAYBACK }),
}));

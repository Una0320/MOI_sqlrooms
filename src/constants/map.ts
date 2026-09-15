export const INITIAL_VIEW_STATE = {
  longitude: 121.4945181576129,
  latitude: 25.111019220248266,
  zoom: 10.6078,
  pitch: 0,
  bearing: 0,
}

// 整張地圖能縮放的範圍。放大超過 MAP_MAX_ZOOM 對這份資料的解析度沒有意義（軌跡/站點都不會再更細），
// 縮小超過 MAP_MIN_ZOOM 畫面會太瑣碎。useStopCountsLayer 的聚合設定要跟著這個上限調。
export const MAP_MIN_ZOOM = 10;
export const MAP_MAX_ZOOM = 15;

export const AGENT_MODE_TRIP_COLORS = [
  [ 28, 197, 248, 150], // WALK      // 淡藍
  [230,  41,  41, 150], // CAR       // 紅
  [217, 138, 241, 150], // BICYCLE   // 紫
  [239, 201,  74, 150], // BUS       // 橘黃
  [114, 225,  84, 150]  // RAIL      // 綠
]

export const AGENT_MODE_TRIP_LENGTH = [
  20, // WALK
  20, // CAR
  20, // BICYCLE
  20, // BUS
  20  // RAIL
]

export enum MOBILITY_MODES {
  WALK = "walk",
  CAR = "car",
  BICYCLE = "bicycle",
  BUS = "bus",
  RAIL = "rail"
}

export const ORDERED_MOBILITY_MODES = [
  MOBILITY_MODES.WALK,    // 0
  MOBILITY_MODES.CAR,     // 1
  MOBILITY_MODES.BICYCLE, // 2
  MOBILITY_MODES.BUS,     // 3
  MOBILITY_MODES.RAIL     // 4
]

export const INITIAL_SELETED_MOBILITY_MODES = [MOBILITY_MODES.WALK, MOBILITY_MODES.CAR, MOBILITY_MODES.BICYCLE, MOBILITY_MODES.BUS, MOBILITY_MODES.RAIL]
export const INITIAL_SELETED_MOBILITY_MODES_BITS = [1,2,4,8,16] // 2^0, 2^1, 2^2, 2^3,...

// 靜態設施點位顏色（02_points/）。刻意不用 AGENT_MODE_TRIP_COLORS 裡的任何一色，
// 避免跟軌跡/agent 點位混淆——地圖底圖是深色，這兩色在深色背景上都夠亮、夠獨立。
export const FACILITY_STATION_COLOR: [number, number, number, number] = [255, 255, 255, 230]; // 站點（公車站+捷運站合併一色）
export const FACILITY_SHELTER_COLOR: [number, number, number, number] = [236, 72, 153, 230]; // 避難所

// 避難所飽和度分級顏色（04_shelter_capacity/ 的 status 欄，empty/low/medium/high/over 五級）
export const SHELTER_STATUS_COLORS: Record<string, [number, number, number, number]> = {
  empty: [100, 149, 237, 160],
  low: [114, 225, 84, 180],
  medium: [239, 201, 74, 200],
  high: [230, 150, 41, 210],
  over: [230, 41, 41, 230],
}

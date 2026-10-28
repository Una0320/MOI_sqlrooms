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

// 索引＝bit 的 log2（0=1, 1=2, 2=4, 3=8, 4=16），跟實際資料的 mode 編碼對齊
// （見 sim_data README：1=walk 2=car 8=bus 16=metro，4 從未出現）。
// index 2（bit=4）目前沒有對應運具——bicycle 已從 UI／篩選中移除，但這個位置保留，
// 避免 BUS(8)/RAIL(16) 的 log2 index 錯位。
export const AGENT_MODE_TRIP_COLORS = [
  [ 28, 197, 248, 150], // WALK      // 淡藍
  [230,  41,  41, 150], // CAR       // 紅
  [217, 138, 241, 150], // (unused，bit=4 保留位)
  [239, 201,  74, 150], // BUS       // 橘黃
  [114, 225,  84, 150]  // RAIL      // 綠
]

export const AGENT_MODE_TRIP_LENGTH = [
  20, // WALK
  20, // CAR
  20, // BUS
  20  // RAIL
]

export enum MOBILITY_MODES {
  WALK = "walk",
  CAR = "car",
  BUS = "bus",
  RAIL = "rail"
}

export const ORDERED_MOBILITY_MODES = [
  MOBILITY_MODES.WALK,
  MOBILITY_MODES.CAR,
  MOBILITY_MODES.BUS,
  MOBILITY_MODES.RAIL
]

// 固定 bit 值，不要用陣列 index 位移推算——bicycle 拿掉後 ORDERED_MOBILITY_MODES 只剩 4 項，
// 1<<index 會讓 BUS/RAIL 對不上實際資料的 8/16 bit。
export const MOBILITY_MODE_BITS: Record<MOBILITY_MODES, number> = {
  [MOBILITY_MODES.WALK]: 1,
  [MOBILITY_MODES.CAR]: 2,
  [MOBILITY_MODES.BUS]: 8,
  [MOBILITY_MODES.RAIL]: 16,
}

export const INITIAL_SELETED_MOBILITY_MODES = [MOBILITY_MODES.WALK, MOBILITY_MODES.CAR, MOBILITY_MODES.BUS, MOBILITY_MODES.RAIL]
export const INITIAL_SELETED_MOBILITY_MODES_BITS = [1,2,8,16]

// bit 值 → 中文標籤，給 Points 圖層的 tooltip 用（哪個路徑、什麼運具）
export const MODE_BIT_LABELS: Record<number, string> = {
  [MOBILITY_MODE_BITS[MOBILITY_MODES.WALK]]: '走路',
  [MOBILITY_MODE_BITS[MOBILITY_MODES.CAR]]: '開車',
  [MOBILITY_MODE_BITS[MOBILITY_MODES.BUS]]: '公車',
  [MOBILITY_MODE_BITS[MOBILITY_MODES.RAIL]]: '捷運',
}

// 避難所分級顏色（交付批次 20261023 README §4 圖例）：status 欄位值是 unused / under_capacity / over_capacity / full。
// 色碼取自 README：#9AA0A6 / #A6D96A / #FDAE61 / #D7191C，alpha 跟著嚴重度遞增。
export const SHELTER_STATUS_COLORS: Record<string, [number, number, number, number]> = {
  unused: [154, 160, 166, 160],
  under_capacity: [166, 217, 106, 190],
  over_capacity: [253, 174, 97, 215],
  full: [215, 25, 28, 235],
}

export const SHELTER_STATUS_LABELS: Record<string, string> = {
  unused: '無人',
  under_capacity: '未超過容量',
  over_capacity: '超收',
  full: '額滿',
}

// Shelter Capacity 圖例的列：順序、中文標籤與條件。顏色一律取自上面的 SHELTER_STATUS_COLORS，圖例與地圖共用同一份。
export const SHELTER_STATUS_LEGEND: { status: keyof typeof SHELTER_STATUS_COLORS; label: string; range: string }[] = [
  { status: 'unused', label: '無人', range: '0 人' },
  { status: 'under_capacity', label: '未超過容量', range: '< 100%' },
  { status: 'over_capacity', label: '超收', range: '≥ 100%、未達上限' },
  { status: 'full', label: '額滿', range: '達 1.5 倍上限' },
];

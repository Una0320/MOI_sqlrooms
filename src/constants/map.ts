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

// 避難所飽和度分級顏色。⚠ 04_shelter_capacity/ 實際 status 欄位值是
// empty/normal/crowded/near_full/over_capacity（不是文件寫的 empty/low/medium/high/over），
// 之前 key 對不上，除了 empty 以外全部 fallback 成灰白色——這才是「圈都是白色半透明」的真正原因。
// 高飽和度的藍→綠→黃→橘→紅色相漸層，alpha 跟著嚴重度一起遞增，色相＋透明度雙重強化區隔。
export const SHELTER_STATUS_COLORS: Record<string, [number, number, number, number]> = {
  empty: [37, 99, 235, 150],
  normal: [16, 185, 129, 170],
  crowded: [250, 204, 21, 195],
  near_full: [249, 115, 22, 215],
  over_capacity: [220, 38, 38, 235],
}

// Shelter Capacity 圖例的列：順序、中文標籤與 load_ratio 範圍（實測 04_shelter_capacity 的 status 切點：
// empty = 0、normal ≤ 0.7、crowded ≤ 0.9、near_full ≤ 1.0、over_capacity > 1.0）。顏色一律取自上面的
// SHELTER_STATUS_COLORS，圖例與地圖共用同一份。
export const SHELTER_STATUS_LEGEND: { status: keyof typeof SHELTER_STATUS_COLORS; label: string; range: string }[] = [
  { status: 'empty', label: '空', range: '0%' },
  { status: 'normal', label: '正常', range: '≤ 70%' },
  { status: 'crowded', label: '擁擠', range: '70 – 90%' },
  { status: 'near_full', label: '接近滿載', range: '90 – 100%' },
  { status: 'over_capacity', label: '超載', range: '> 100%' },
];

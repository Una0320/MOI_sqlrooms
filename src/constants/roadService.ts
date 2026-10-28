// Road Service（道路服務水準）圖層的視覺編碼。資料來自 06_road_service/road_service_<場次>.parquet（逐小時），
// 一列 = 一條路段 × 警報後一小時；level 1–6（1 最順、6 最塞）由 speed_ratio（速限下通過時間 ÷ 實際平均通過時間）分級：
//   1 ≥ 0.90 · 2 0.80–0.90 · 3 0.60–0.80 · 4 0.40–0.60 · 5 0.20–0.40 · 6 < 0.20
// 色碼與相對線寬取自交付批次 README §4 圖例。

import { AGENT_MODE_TRIP_COLORS, MOBILITY_MODE_BITS, MOBILITY_MODES } from './map';

export type RoadLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const ROAD_LEVELS: readonly RoadLevel[] = [1, 2, 3, 4, 5, 6];

// 服務水準色碼——**唯一來源**：圖例色塊（RoadServiceLegend）與地圖路段（useRoadServiceLayer）
// 都從這裡取，不要在別處再寫一份。
export const ROAD_LEVEL_HEX: Record<RoadLevel, string> = {
  1: '#44C23A',
  2: '#8CD17D',
  3: '#DFD34E',
  4: '#DF9651',
  5: '#D15528',
  6: '#C22E00',
};

// 地圖上用的 RGBA（由 ROAD_LEVEL_HEX 轉出）。alpha 全部統一，地圖上的顏色才會跟圖例色塊一致。
const ROAD_ALPHA = 220;
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
export const ROAD_LEVEL_COLORS = Object.fromEntries(
  ROAD_LEVELS.map((lv) => [lv, [...hexToRgb(ROAD_LEVEL_HEX[lv]), ROAD_ALPHA]]),
) as Record<RoadLevel, [number, number, number, number]>;

// 圖例上每個等級的說明（速率比範圍，來自 README §4）
export const ROAD_LEVEL_LABELS: Record<RoadLevel, string> = {
  1: '≥ 0.90（最順）',
  2: '0.80 – 0.90',
  3: '0.60 – 0.80',
  4: '0.40 – 0.60',
  5: '0.20 – 0.40',
  6: '< 0.20（最塞）',
};

// 線寬：README §4 給的是相對線寬（level 1 → 0.45 … level 6 → 1.9），乘上基準像素寬度。
const ROAD_WIDTH_REL: Record<RoadLevel, number> = { 1: 0.45, 2: 0.6, 3: 0.85, 4: 1.15, 5: 1.5, 6: 1.9 };
const ROAD_WIDTH_BASE_PX = 4;
export const ROAD_WIDTH_MIN_PX = 1.5;
export const ROAD_WIDTH_MAX_PX = 8;

export const roadWidthPx = (level: RoadLevel): number => ROAD_WIDTH_REL[level] * ROAD_WIDTH_BASE_PX;

// 縮放：地圖 z10（最小）線細一點避免糊成一片，z15（最大）放寬到 1.6 倍；線性內插
export const roadWidthScaleForZoom = (zoom: number, minZoom: number, maxZoom: number): number => {
  const t = Math.min(1, Math.max(0, (zoom - minZoom) / (maxZoom - minZoom)));
  return 0.6 + t * 1.0;
};

// ───────────────────────── Road Control（道路管制）─────────────────────────
// 07_road_control/road_control.parquet 的 measure 欄位與建議顏色（README §4）。
export type RoadControlMeasure = 'closure' | 'car_ban' | 'bus_lane';
const [busR, busG, busB] = AGENT_MODE_TRIP_COLORS[Math.log2(MOBILITY_MODE_BITS[MOBILITY_MODES.BUS])];
const BUS_HEX = `#${[busR, busG, busB].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export const ROAD_CONTROL_HEX: Record<RoadControlMeasure, string> = {
  closure: '#9E9E9E',
  car_ban: '#FB5744',
  bus_lane: BUS_HEX, // 跟 Mobility Modes 的 BUS 同色（取自 AGENT_MODE_TRIP_COLORS，單一來源）
};
export const ROAD_CONTROL_LABELS: Record<RoadControlMeasure, string> = {
  closure: '封路',
  car_ban: '禁小客車（進淡水八里）',
  bus_lane: '出城公車專用道',
};
export const ROAD_CONTROL_MEASURES = Object.keys(ROAD_CONTROL_HEX) as RoadControlMeasure[];
export const ROAD_CONTROL_COLORS = Object.fromEntries(
  ROAD_CONTROL_MEASURES.map((m) => [m, [...hexToRgb(ROAD_CONTROL_HEX[m]), 230]]),
) as Record<RoadControlMeasure, [number, number, number, number]>;

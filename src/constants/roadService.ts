// Road Service（道路服務水準）圖層的視覺編碼。資料來自 05_moi_sim/road_service_<情境>.geojson，
// 欄位關係（pt20 實測，30,038 條路段）：
//   V/C       = volume_pce / capacity_vph（尖峰小時 PCE ÷ link 容量）
//   log_V/C   = log10(1 + V/C)   ← 不是 log10(V/C)；那個在 log10_VC 欄
//   LOS       = 依 V/C 分級，門檻 0.5/0.65/0.75/1.0/1.2 → A..F（A≤0.5、B≤0.65、C≤0.75、D≤1.0、E≤1.2、F>1.2）
// 實測值域：V/C 0.0001–0.9928（99.3% 是 A），log_V/C 0–0.2995。pt20 只出現 A–D，
// 但 E/F 是別的情境可能出現的等級，色階與 legend 仍完整保留 A–F。

export type LOSLevel = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const LOS_LEVELS: readonly LOSLevel[] = ['A', 'B', 'C', 'D', 'E', 'F'];

// LOS A–F 色碼——**唯一來源**：圖例色塊（RoadServiceLegend）與地圖路段（useRoadServiceLayer）
// 都從這裡取，不要在別處再寫一份。
export const LOS_HEX: Record<LOSLevel, string> = {
  A: '#44C23A',
  B: '#1FB33B',
  C: '#DFD34E',
  D: '#DF9651',
  E: '#D15528',
  F: '#C22E00',
};

// 地圖上用的 RGBA（由 LOS_HEX 轉出）。alpha 全部統一，不再依等級調整，這樣地圖上的顏色
// 才會跟圖例色塊一致（線寬細，A 級雖然占 99%，也不會把整張地圖蓋滿）。
const LOS_ALPHA = 220;
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
export const LOS_COLORS = Object.fromEntries(
  LOS_LEVELS.map((los) => [los, [...hexToRgb(LOS_HEX[los]), LOS_ALPHA]]),
) as Record<LOSLevel, [number, number, number, number]>;

// 圖例上每個等級的中文說明（圖例不顯示任何門檻數值）
export const LOS_DESCRIPTIONS: Record<LOSLevel, string> = {
  A: '自由車流',
  B: '穩定車流（少許延滯）',
  C: '穩定車流（延滯可接受）',
  D: '接近不穩定（延滯可容忍）',
  E: '不穩定車流（延滯不可容忍）',
  F: '強迫車流（交通阻塞）',
};

// 線寬映射：t = sqrt(log_V/C / LOG_VC_REF) 夾在 0–1，再線性映射到 [MIN, MAX] px。
// 用 sqrt 是因為值域極度偏斜（中位數 log_V/C 僅 0.0022、p99 才 0.148），線性映射下
// 幾乎所有路段都會擠在最小寬度。LOG_VC_REF = log10(1 + 1.2) = F 級門檻，固定常數而不是
// 「這份資料的最大值」，這樣不同情境的線寬可以互相比較，legend 也不用跟著資料變。
export const ROAD_WIDTH_MIN_PX = 1.5;
export const ROAD_WIDTH_MAX_PX = 8;
const LOG_VC_REF = Math.log10(1 + 1.2);

export const roadWidthPx = (logVc: number): number => {
  const t = Math.min(1, Math.sqrt(Math.max(0, logVc) / LOG_VC_REF));
  return ROAD_WIDTH_MIN_PX + t * (ROAD_WIDTH_MAX_PX - ROAD_WIDTH_MIN_PX);
};


// 縮放：地圖 z10（最小）線細一點避免糊成一片，z15（最大）放寬到 1.6 倍；線性內插
export const roadWidthScaleForZoom = (zoom: number, minZoom: number, maxZoom: number): number => {
  const t = Math.min(1, Math.max(0, (zoom - minZoom) / (maxZoom - minZoom)));
  return 0.6 + t * 1.0;
};

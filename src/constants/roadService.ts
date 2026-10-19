// Road Service（道路服務水準）圖層的視覺編碼。資料來自 05_moi_sim/road_service_<情境>.geojson，
// 欄位關係（pt20 實測，30,038 條路段）：
//   V/C       = volume_pce / capacity_vph（尖峰小時 PCE ÷ link 容量）
//   log_V/C   = log10(1 + V/C)   ← 不是 log10(V/C)；那個在 log10_VC 欄
//   LOS       = 依 V/C 分級，門檻 0.5/0.65/0.75/1.0/1.2 → A..F（A≤0.5、B≤0.65、C≤0.75、D≤1.0、E≤1.2、F>1.2）
// 實測值域：V/C 0.0001–0.9928（99.3% 是 A），log_V/C 0–0.2995。pt20 只出現 A–D，
// 但 E/F 是別的情境可能出現的等級，色階與 legend 仍完整保留 A–F。

export type LOSLevel = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const LOS_LEVELS: readonly LOSLevel[] = ['A', 'B', 'C', 'D', 'E', 'F'];

// 綠→黃→橘→紅→暗紅。A 級占絕大多數，alpha 壓低，免得整張地圖被綠線蓋滿、蓋掉真正壅塞的路段
export const LOS_COLORS: Record<LOSLevel, [number, number, number, number]> = {
  A: [34, 197, 94, 130],
  B: [163, 230, 53, 190],
  C: [250, 204, 21, 220],
  D: [249, 115, 22, 235],
  E: [239, 68, 68, 245],
  F: [185, 28, 28, 255],
};

export const LOS_LABELS: Record<LOSLevel, string> = {
  A: 'V/C ≤ 0.50',
  B: '0.50 – 0.65',
  C: '0.65 – 0.75',
  D: '0.75 – 1.00',
  E: '1.00 – 1.20',
  F: '> 1.20',
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

// legend 的粗細對照：[V/C, 對應 log_V/C 的線寬]
export const ROAD_WIDTH_SAMPLES: readonly number[] = [0.05, 0.5, 1.0, 1.2];
export const logVcOf = (vc: number): number => Math.log10(1 + vc);

// 縮放：地圖 z10（最小）線細一點避免糊成一片，z15（最大）放寬到 1.6 倍；線性內插
export const roadWidthScaleForZoom = (zoom: number, minZoom: number, maxZoom: number): number => {
  const t = Math.min(1, Math.max(0, (zoom - minZoom) / (maxZoom - minZoom)));
  return 0.6 + t * 1.0;
};

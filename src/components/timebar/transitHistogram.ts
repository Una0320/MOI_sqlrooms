// Timeline 直方圖的資料處理（純函式，沒有 React / DuckDB 依賴，方便單獨驗證）。
//
// 輸入是 evac_transit 表（見 hooks/useEvacArrivalsView.ts）的列：每個運具「在途人數」的階梯函數
// （t = 60 秒格的起點、mode = 運具 bit、persons = 從這格起到下一列為止的人數）。
// 在途 = 已出發（departure_s <= t）且尚未抵達（t < 最後一個時間戳），包含停在站上等車的人；
// 運具 = 這個人「當下那一段」的運具（與地圖的逐段過濾一致），所以四個運具加總 = 在途總人數。

// 堆疊順序：自下而上 WALK、CAR、BUS、RAIL（與運具 bit 1 / 2 / 8 / 16 對應）
export const STACK_MODE_BITS = [1, 2, 8, 16] as const;
const MODE_INDEX: Record<number, number> = { 1: 0, 2: 1, 8: 2, 16: 3 };
const N_MODES = STACK_MODE_BITS.length;

export type TransitGrid = {
  binSec: number;
  nBins: number;
  /** [bin * 4 + 運具順序]；bin k 代表時刻 k * binSec 的瞬時在途人數 */
  persons: Int32Array;
  /** 四運具全選時最大的時間格總人數（高度分母，載入時算一次，不隨 selectedModes 變） */
  maxTotal: number;
};

/** rows 必須先依 (mode, t) 排序（SQL 端 ORDER BY mode, t）。把稀疏的階梯函數展開成 時間格 × 運具 的 typed array。 */
export const buildTransitGrid = (
  t: ArrayLike<number>,
  mode: ArrayLike<number>,
  persons: ArrayLike<number>,
  binSec: number,
): TransitGrid | null => {
  const n = t.length;
  if (n === 0) return null;
  let maxBin = 0;
  for (let i = 0; i < n; i++) maxBin = Math.max(maxBin, Math.round(Number(t[i]) / binSec));
  const nBins = maxBin + 1;
  const grid = new Int32Array(nBins * N_MODES);
  for (let i = 0; i < n; i++) {
    const mi = MODE_INDEX[Number(mode[i])];
    if (mi === undefined) continue;
    const from = Math.round(Number(t[i]) / binSec);
    // 到「同運具的下一列」為止（列已依 mode, t 排序；換運具或最後一列就填到尾端，反正最後一列的值是 0）
    let to = nBins;
    if (i + 1 < n && Number(mode[i + 1]) === Number(mode[i])) to = Math.round(Number(t[i + 1]) / binSec);
    const v = Number(persons[i]);
    for (let k = from; k < to; k++) grid[k * N_MODES + mi] = v;
  }
  let maxTotal = 0;
  for (let k = 0; k < nBins; k++) {
    let s = 0;
    for (let m = 0; m < N_MODES; m++) s += grid[k * N_MODES + m];
    if (s > maxTotal) maxTotal = s;
  }
  return { binSec, nBins, persons: grid, maxTotal };
};

export type StackedBars = {
  nBars: number;
  barSec: number;
  /** [bar * 4 + 運具順序] = 該運具人數 ÷ maxTotal（沒勾選的運具 = 0）；一根長條的總高 = 四個值相加 */
  seg: Float32Array;
};

/**
 * 依目前檢視範圍 [startSec, endSec] 取樣成最多 maxBars 根長條；每根取「長條起點時刻」的瞬時值
 * （point-in-time，不是區間平均）。selectedBits 只影響哪些運具被加進去，不會觸發任何 SQL。
 */
export const stackBars = (
  grid: TransitGrid,
  selectedBits: readonly number[],
  startSec: number,
  endSec: number,
  baseBinSec: number,
  maxBars: number,
): StackedBars => {
  let barSec = baseBinSec;
  let nBars = Math.max(0, Math.ceil((endSec - startSec) / barSec));
  if (nBars > maxBars) {
    barSec = (endSec - startSec) / maxBars;
    nBars = maxBars;
  }
  const seg = new Float32Array(nBars * N_MODES);
  const on = [false, false, false, false];
  for (const b of selectedBits) {
    const mi = MODE_INDEX[b];
    if (mi !== undefined) on[mi] = true;
  }
  if (grid.maxTotal <= 0) return { nBars, barSec, seg };
  for (let b = 0; b < nBars; b++) {
    const k = Math.floor((startSec + b * barSec) / grid.binSec);
    if (k < 0 || k >= grid.nBins) continue;
    for (let m = 0; m < N_MODES; m++) {
      if (on[m]) seg[b * N_MODES + m] = grid.persons[k * N_MODES + m] / grid.maxTotal;
    }
  }
  return { nBars, barSec, seg };
};

/** 整根長條低於這個比例（佔容器高度）就等比例放大到這個高度，避免太矮看不見 */
export const MIN_BAR_FRACTION = 0.05;

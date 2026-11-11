// Timeline 直方圖的資料處理（純函式，沒有 React / DuckDB 依賴，方便單獨驗證）。
//
// 輸入是 evac_transit 表（見 hooks/useEvacArrivalsView.ts）的列：每個運具「在途人數」的階梯函數
// （t = 60 秒格的起點、mode = 運具 bit、persons = 從這格起到下一列為止的人數）。
// 每根長條取「格內 60 秒樣本的平均同時在途人數」（binBars）；selectedModes 只影響 selectBars 的加總。
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
  /** 前綴和 [(bin) * 4 + 運具順序]，長度 (nBins + 1) * 4：prefix[k] = bin 0..k-1 的瞬時人數總和（求格內平均用） */
  prefix: Float64Array;
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
  const prefix = new Float64Array((nBins + 1) * N_MODES);
  for (let k = 0; k < nBins; k++) {
    for (let m = 0; m < N_MODES; m++) prefix[(k + 1) * N_MODES + m] = prefix[k * N_MODES + m] + grid[k * N_MODES + m];
  }
  return { binSec, nBins, persons: grid, prefix };
};

export type BinnedBars = {
  nBars: number;
  barSec: number;
  /** [bar * 4 + 運具順序] = 這根長條涵蓋的 60 秒樣本的「平均同時在途人數」（四運具各自平均；加總 = 全體平均） */
  avg: Float32Array;
  /** 四運具全選時，最大的長條總平均人數（高度分母；載入時算一次，不隨 selectedModes 改變） */
  maxTotal: number;
};

/**
 * 依檢視範圍 [startSec, endSec] 切成最多 maxBars 根長條，每根取「格內所有 60 秒樣本的平均」
 * （樣本 = 瞬時在途人數，時刻 k * 60 落在 [長條起點, 長條起點 + barSec) 的那幾個；用前綴和 O(1) 求平均）。
 * 平均，而不是格起點的瞬時值——否則第一根（t = 0，幾乎還沒人出發）會幾乎是 0，與格內實際情況不符。
 * 只在資料或檢視範圍變動時重算一次；切換 selectedModes 不需要重算，也不碰 SQL。
 */
export const binBars = (
  grid: TransitGrid,
  startSec: number,
  endSec: number,
  baseBinSec: number,
  maxBars: number,
): BinnedBars => {
  let barSec = baseBinSec;
  let nBars = Math.max(0, Math.ceil((endSec - startSec) / barSec));
  if (nBars > maxBars) {
    barSec = (endSec - startSec) / maxBars;
    nBars = maxBars;
  }
  const avg = new Float32Array(nBars * N_MODES);
  let maxTotal = 0;
  for (let b = 0; b < nBars; b++) {
    const a0 = startSec + b * barSec;
    let k0 = Math.ceil(a0 / grid.binSec - 1e-9);
    let k1 = Math.ceil((a0 + barSec) / grid.binSec - 1e-9) - 1;
    if (k1 < k0) k1 = k0; // 長條比一格還窄：只有一個樣本
    k0 = Math.max(0, k0);
    k1 = Math.min(grid.nBins - 1, k1);
    if (k1 < k0) continue;
    const cnt = k1 - k0 + 1;
    let total = 0;
    for (let m = 0; m < N_MODES; m++) {
      const v = (grid.prefix[(k1 + 1) * N_MODES + m] - grid.prefix[k0 * N_MODES + m]) / cnt;
      avg[b * N_MODES + m] = v;
      total += v;
    }
    if (total > maxTotal) maxTotal = total;
  }
  return { nBars, barSec, avg, maxTotal };
};

export type StackedBars = {
  nBars: number;
  /** [bar * 4 + 運具順序] = 該運具平均人數 ÷ maxTotal（沒勾選的運具 = 0）；一根長條的總高 = 四個值相加 */
  seg: Float32Array;
};

/** 依 selectedModes 取出要堆疊的運具，並除以固定分母。這一步只是 typed array 運算，不碰 SQL。 */
export const selectBars = (binned: BinnedBars, selectedBits: readonly number[]): StackedBars => {
  const seg = new Float32Array(binned.nBars * N_MODES);
  if (binned.maxTotal <= 0) return { nBars: binned.nBars, seg };
  const on = [false, false, false, false];
  for (const b of selectedBits) {
    const mi = MODE_INDEX[b];
    if (mi !== undefined) on[mi] = true;
  }
  for (let b = 0; b < binned.nBars; b++) {
    for (let m = 0; m < N_MODES; m++) {
      if (on[m]) seg[b * N_MODES + m] = binned.avg[b * N_MODES + m] / binned.maxTotal;
    }
  }
  return { nBars: binned.nBars, seg };
};

/** 整根長條低於這個比例（佔容器高度）就等比例放大到這個高度，避免太矮看不見 */
export const MIN_BAR_FRACTION = 0.05;

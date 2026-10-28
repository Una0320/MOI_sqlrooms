import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useResolvedFiles } from './useResolvedFiles';

// 左上角的完成率曲線：以「抵達終點（該列軌跡最後一筆時間戳）」視為完成。
//   rate(t) = 抵達時間 <= t 的權重 / 總權重 × 100
// 載入情境時用一支 DuckDB 查詢取出每列的抵達時間與權重（依抵達時間排序），算好累計權重陣列；
// 播放時只對它做二分搜尋查表（見 evacuationRateAt），不會每個 frame 重打查詢。
// 這是「累計值」：不受時間窗口（timeRange）與 selectedModes 影響。
//
// 口徑（交付批次 20261023）：軌跡檔一列 = 一個 agent（一台家戶車或一戶人），帶 n_persons，
// 權重 = COALESCE(n_persons, 1)，所以是「人數」口徑；完成 = 該列最後一個時間戳 <= t。
// ⚠ 基於軌跡抽樣（1 / 4 / 5 / 7 萬個 agent，以戶為單位），百分比假設抽樣是均勻的；絕對人數不是全量。
export type EvacuationCurve = {
  label: string; // 面板上的標籤
  note: string; // tooltip 說明
} & (
  | { kind: 'unavailable' } // 沒有軌跡資料的組合
  | { kind: 'loading' } // 查詢還沒回來
  | {
      kind: 'ready';
      arrivals: Float64Array; // 升冪排序的抵達時間（秒）
      cumWeights: Float64Array; // cumWeights[i] ＝ arrivals[0..i] 的權重累計
      totalWeight: number;
    }
);

// ⚠ 面板標籤固定為 'Evac Rate'（E、R 大寫，中間一個空格）——使用者明確指定，不要改字樣、大小寫或字級。
const LABEL = 'Evac Rate';
const NOTE = '人數口徑（依各 agent 的 n_persons 加權），基於軌跡抽樣的 agent。';

export const useEvacuationCurve = (): EvacuationCurve => {
  const { dataUrl } = useResolvedFiles();
  const enabled = dataUrl !== null;

  // 沒資料的組合查一個零列 SQL（hook 不能條件式呼叫）
  const { data } = useSql<{ t_end: number; w: number }>({
    query: enabled
      ? `SELECT list_max(timestamps) AS t_end, COALESCE(n_persons, 1) AS w FROM read_parquet('${dataUrl}') WHERE len(timestamps) > 0 ORDER BY t_end`
      : 'SELECT CAST(NULL AS DOUBLE) AS t_end, CAST(NULL AS INTEGER) AS w WHERE false',
  });
  const arrowTable = data?.arrowTable;

  return useMemo<EvacuationCurve>(() => {
    const meta = { label: LABEL, note: NOTE };
    if (!enabled) return { ...meta, kind: 'unavailable' };
    const tCol = arrowTable?.getChild('t_end');
    const wCol = arrowTable?.getChild('w');
    if (!tCol || !wCol || tCol.length === 0) return { ...meta, kind: 'loading' };
    const arrivals = Float64Array.from(tCol.toArray() as ArrayLike<number>);
    const weights = wCol.toArray() as ArrayLike<number>;
    const cumWeights = new Float64Array(arrivals.length);
    let sum = 0;
    for (let i = 0; i < arrivals.length; i++) {
      sum += Number(weights[i]);
      cumWeights[i] = sum;
    }
    return { ...meta, kind: 'ready', arrivals, cumWeights, totalWeight: sum };
  }, [enabled, arrowTable]);
};

// 抵達時間 <= t 的累計權重 / 總權重 × 100（upper-bound 二分搜尋）；非 ready 時回 null
export const evacuationRateAt = (curve: EvacuationCurve, t: number): number | null => {
  if (curve.kind !== 'ready' || curve.totalWeight === 0) return null;
  const a = curve.arrivals;
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : (curve.cumWeights[lo - 1] / curve.totalWeight) * 100;
};

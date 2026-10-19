import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useResolvedFiles } from './useResolvedFiles';

// 左上角的完成率曲線：以「抵達終點（該列軌跡最後一筆時間戳）」視為完成。
//   rate(t) = 抵達時間 <= t 的權重 / 總權重 × 100
// 載入情境時用一支 DuckDB 查詢取出每列的抵達時間與權重（依抵達時間排序），算好累計權重陣列；
// 播放時只對它做二分搜尋查表（見 evacuationRateAt），不會每個 frame 重打查詢。
// 這是「累計值」：不受時間窗口（timeRange）與 selectedModes 影響。
//
// 兩種口徑由 manifest 的 evacuationRate 決定（見 constants/data.ts）：
//   'people_weighted'（evac_ratio）→ 人數口徑：
//     一列 = 一個 agent；modes 含 car(2) 算 4 人、其餘算 1 人（sim_data README：car agent 代表 4 人）。
//     05_moi_sim 的 modes 是逐頂點清單，實測六個檔共 60,000 列每列都只有單一運具（沒有同時含 car 與
//     walk 的 agent）；若以後出現混合列，整個 agent 算 4。
//     ⚠ 基於 05_moi_sim 的 10,000 列抽樣（evac10 抽 10,000/10,510，evac40 只抽 10,000/40,133），
//     百分比假設抽樣是均勻的；絕對人數不是全量。
//   'leg_count'（pt*）→ 標籤同樣是「Evacuation rate」，每列權重 1：
//     pt 的列是 leg（一段移動，agent 可有最多 12 段），05 又沒有 person_id，無法判定一個人是否走完
//     全部行程，所以這是「以移動段計」的比率，不是嚴格的人員撤離率，靠 hover 提示講清楚。
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

const LABEL = 'Evacuation rate'; // 所有情境一律這個標籤
const PEOPLE_NOTE = '人數口徑（car agent = 4 人，其餘 = 1 人），基於 05_moi_sim 的 10,000 列抽樣。';
const LEG_NOTE = '以移動段(leg)計，資料缺少 person_id，非嚴格的人員撤離率';

export const useEvacuationCurve = (): EvacuationCurve => {
  const { dataUrl, evacuationRate } = useResolvedFiles();
  const enabled = evacuationRate !== null && dataUrl !== null;
  const weightSql =
    evacuationRate === 'people_weighted' ? 'CASE WHEN list_contains(modes, 2) THEN 4 ELSE 1 END' : '1';

  // 沒資料的組合查一個零列 SQL（hook 不能條件式呼叫）
  const { data } = useSql<{ t_end: number; w: number }>({
    query: enabled
      ? `SELECT list_max(timestamps) AS t_end, ${weightSql} AS w FROM read_parquet('${dataUrl}') WHERE len(timestamps) > 0 ORDER BY t_end`
      : 'SELECT CAST(NULL AS DOUBLE) AS t_end, CAST(NULL AS INTEGER) AS w WHERE false',
  });
  const arrowTable = data?.arrowTable;

  return useMemo<EvacuationCurve>(() => {
    const people = evacuationRate === 'people_weighted';
    const meta = { label: LABEL, note: people ? PEOPLE_NOTE : LEG_NOTE };
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
  }, [enabled, evacuationRate, arrowTable]);
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

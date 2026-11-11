import { useEffect } from 'react';
import { create } from 'zustand';
import { vg } from '@sqlrooms/mosaic';
import { useStoreWithDuckDb } from '@sqlrooms/duckdb';
import { useResolvedFiles } from './useResolvedFiles';

// 每個情境（run × 抽樣量）建立兩張小表，供 headline Evac Rate 與「分運具 Evac Rate」折線圖共用，
// 軌跡 parquet 只掃這一次：
//   evac_arrivals(mode, t_end, t_start, w, runs)
//                                   一列一個 agent：主要運具、抵達時間（秒）、出發時間（秒，= departure_s）、權重、
//                                   以及「連續同運具區間」runs = [{t0, t1, m}]（m = 該區間的運具 bit 1/2/8/16）
//   evac_curve(mode, t, pct)        四個運具、每 60 秒一格的累計完成率（%），含起點 0 與延伸到時間軸末端
//   evac_curve_all(mode, t, pct)    同上，mode = 'ALL'（所有 agent，數值要與 headline 一致）
//   evac_transit(t, mode, persons)  Timeline 直方圖用：每個運具「在途人數」的階梯函數（只在人數有變的 60 秒格有列，
//                                   mode = 運具 bit）。在途 = t_start <= t < t_end（包含停在站上等車），
//                                   每人每刻只算他「當下那一段」的運具；每格取格起點時刻的瞬時值。
//                                   由 evac_arrivals.runs 差分得到（出發格 +w、結束格 -w，再按運具累計和），
//                                   所以不必再掃 parquet、也不必對每個 agent 展開所有時間格。
//
// ⚠ 刻意用 TABLE 而不是 VIEW：DuckDB 的 view 是惰性的，每次查詢都會重掃 read_parquet（遠端 Range request），
//   那就達不到「避免重複掃描」的目的。這三張表最多 7 萬列／數百列，常駐記憶體沒有負擔。
//
// mode 歸類：list_max(modes) —— 每個 agent 只算一個「主要運具」，優先序 RAIL(16) > BUS(8) > CAR(2) > WALK(1)。
//   轉乘者歸入轉乘後（最遠）的運具；WALK 只含純步行者。這跟地圖的運具過濾（逐段，取消 BUS 只隱藏公車段）語意不同，
//   兩者刻意不統一（見 CLAUDE.md）。
// 權重 = COALESCE(n_persons, 1)，人數口徑。
export const EVAC_ARRIVALS_TABLE = 'evac_arrivals';
export const EVAC_CURVE_TABLE = 'evac_curve';
export const EVAC_CURVE_ALL_TABLE = 'evac_curve_all';
export const EVAC_TRANSIT_TABLE = 'evac_transit';
export const EVAC_BUCKET_SEC = 60;
// 直方圖的時間格寬度（evac_transit 的格寬）；Timeline 的 BIN_SIZE 必須與它一致
export const EVAC_TRANSIT_BIN_SEC = 60;

const buildStatements = (dataUrl: string): string[] => [
  // modes 與 timestamps 逐頂點平行，modes[i] = 頂點 i 到 i+1 那一段的運具（與地圖、Points 層相同的慣例；
  // 停在站上等車的靜止段標的是「要搭的車」）。st = 每個「連續同運具區間」的第一個段（1 起算），
  // runs 再把它收合成 (t0, t1, m)，最後一個區間的 t1 = 最後一個時間戳。
  `CREATE OR REPLACE TABLE ${EVAC_ARRIVALS_TABLE} AS
   SELECT CASE list_max(modes) WHEN 1 THEN 'WALK' WHEN 2 THEN 'CAR' WHEN 8 THEN 'BUS' WHEN 16 THEN 'RAIL' END AS mode,
          CAST(list_max(timestamps) AS DOUBLE) AS t_end,
          CAST(COALESCE(departure_s, list_min(timestamps)) AS DOUBLE) AS t_start,
          CAST(COALESCE(n_persons, 1) AS INTEGER) AS w,
          list_transform(range(1, len(st) + 1), k -> struct_pack(
            t0 := CAST(timestamps[st[k]] AS DOUBLE),
            t1 := CAST(timestamps[COALESCE(st[k + 1], len(timestamps))] AS DOUBLE),
            m := modes[st[k]])) AS runs
   FROM (
     SELECT timestamps, modes, n_persons, departure_s,
            list_filter(range(1, len(timestamps)), i -> i = 1 OR modes[i] <> modes[i - 1]) AS st
     FROM read_parquet('${dataUrl}')
     WHERE len(timestamps) > 0
   )`,
  // 每 60 秒一格：agent 歸入 ceil(t_end/60)*60 這一格，所以 t 為 60 的倍數時「格值 = 抵達時間 <= t 的累計權重」，
  // 與 headline（抵達時間 <= t）逐點相同；非 60 倍數的 t，圖上是 step-after，等於 floor(t/60)*60 的值。
  `CREATE OR REPLACE TABLE ${EVAC_CURVE_TABLE} AS
   WITH b AS (
     SELECT mode, CAST(ceil(t_end / ${EVAC_BUCKET_SEC}.0) AS INTEGER) * ${EVAC_BUCKET_SEC} AS t, CAST(SUM(w) AS DOUBLE) AS w
     FROM ${EVAC_ARRIVALS_TABLE} GROUP BY 1, 2
   ),
   c AS (
     SELECT mode, t,
            SUM(w) OVER (PARTITION BY mode ORDER BY t) / SUM(w) OVER (PARTITION BY mode) * 100 AS pct
     FROM b
   ),
   mx AS (SELECT MAX(t) AS tmax FROM c),
   modes AS (SELECT DISTINCT mode FROM c)
   SELECT mode, 0 AS t, 0.0 AS pct FROM modes
   UNION ALL SELECT mode, t, pct FROM c
   UNION ALL SELECT mode, tmax AS t, 100.0 AS pct FROM modes, mx`,
  `CREATE OR REPLACE TABLE ${EVAC_CURVE_ALL_TABLE} AS
   WITH b AS (
     SELECT CAST(ceil(t_end / ${EVAC_BUCKET_SEC}.0) AS INTEGER) * ${EVAC_BUCKET_SEC} AS t, CAST(SUM(w) AS DOUBLE) AS w
     FROM ${EVAC_ARRIVALS_TABLE} GROUP BY 1
   ),
   c AS (SELECT t, SUM(w) OVER (ORDER BY t) / SUM(w) OVER () * 100 AS pct FROM b)
   SELECT 'ALL' AS mode, 0 AS t, 0.0 AS pct
   UNION ALL SELECT 'ALL' AS mode, t, pct FROM c
   UNION ALL SELECT 'ALL' AS mode, MAX(t) AS t, 100.0 AS pct FROM c`,
  // 區間 [max(t0, t_start), t1) 涵蓋的格起點 = k0 .. k1-1（k = ceil(秒 / 格寬)）；差分 +w@k0、-w@k1，再按運具累計和。
  `CREATE OR REPLACE TABLE ${EVAC_TRANSIT_TABLE} AS
   WITH iv AS (
     SELECT w, r.m AS m,
            CAST(ceil(greatest(r.t0, t_start) / ${EVAC_TRANSIT_BIN_SEC}.0) AS INTEGER) AS k0,
            CAST(ceil(r.t1 / ${EVAC_TRANSIT_BIN_SEC}.0) AS INTEGER) AS k1
     FROM (SELECT w, t_start, unnest(runs) AS r FROM ${EVAC_ARRIVALS_TABLE})
     WHERE greatest(r.t0, t_start) < r.t1
   ),
   d AS (
     SELECT k0 AS k, m, SUM(w) AS dw FROM iv WHERE k1 > k0 GROUP BY 1, 2
     UNION ALL SELECT k1 AS k, m, -SUM(w) AS dw FROM iv WHERE k1 > k0 GROUP BY 1, 2
   ),
   dd AS (SELECT k, m, SUM(dw) AS dw FROM d GROUP BY 1, 2)
   SELECT CAST(k * ${EVAC_TRANSIT_BIN_SEC} AS INTEGER) AS t, CAST(m AS UTINYINT) AS mode,
          CAST(SUM(dw) OVER (PARTITION BY m ORDER BY k) AS INTEGER) AS persons
   FROM dd`,
];

type EvacTablesState = { readyUrl: string | null };
let buildChain: Promise<void> = Promise.resolve();
const useEvacTablesStore = create<EvacTablesState>(() => ({ readyUrl: null }));

// 在 MainView 呼叫一次：dataUrl 變動（切情境 / 抽樣量 / 管制）就重建這三張表。
export const useEvacTables = () => {
  const { dataUrl } = useResolvedFiles();
  const getConnector = useStoreWithDuckDb((s) => s.db.getConnector);

  useEffect(() => {
    useEvacTablesStore.setState({ readyUrl: null });
    if (!dataUrl) return;
    let cancelled = false;
    // 串行化：StrictMode 會讓 effect 跑兩次、快速切情境也會疊好幾次，同時 CREATE OR REPLACE 同一張表
    // 會得到 "Catalog write-write conflict"。排成一條 promise 鏈，輪到時發現已取消就直接跳過。
    buildChain = buildChain.then(async () => {
      if (cancelled) return;
      const connector = await getConnector();
      for (const sql of buildStatements(dataUrl)) {
        if (cancelled) return;
        await connector.execute(sql).result;
      }
      if (cancelled) return;
      // Mosaic coordinator 會依 SQL 文字快取結果；表被 CREATE OR REPLACE 後同一支 SQL 會回舊資料，要清掉快取。
      // （clients: false：不要拆掉已註冊的 client。）
      vg.coordinator().clear({ clients: false, cache: true });
      useEvacTablesStore.setState({ readyUrl: dataUrl });
    }).catch((e) => {
      if (!cancelled) console.error('[evac tables] 建表失敗', e);
    });
    return () => {
      cancelled = true;
    };
  }, [dataUrl, getConnector]);
};

// 目前情境的三張表是否已建好（dataUrl 為 null 的組合永遠是 false）
export const useEvacTablesReady = (): boolean => {
  const { dataUrl } = useResolvedFiles();
  const readyUrl = useEvacTablesStore((s) => s.readyUrl);
  return dataUrl !== null && readyUrl === dataUrl;
};

import { useEffect, useMemo, useRef } from "react";
// 【白色把手已停用，見檔案下方「白色把手停用說明」】恢復時改回下面這一行（要加回 useState）：
// import { useEffect, useMemo, useRef, useState } from "react";
import { useMapStore, DEFAULT_TIME_WINDOW_SEC } from "@/zustand/useMapStore";
import { useSql } from "@sqlrooms/duckdb";
import { useShallow } from "@sqlrooms/room-shell";
import { useResolvedFiles } from "@/hooks/useResolvedFiles";

const BIN_SIZE = 60;            // SQL 粒度:60 秒一格(夠細,JS 端再做視覺重取樣)
const HARD_MAX_SEC = 72 * 3600; // 顯示上限:72:00:00(模擬約到警報後 69 小時、最晚抵達約 46 小時)
const step = 10 * 60;           // 滑桿的吸附步長:10 分鐘
const MAX_BARS = 50;            // 視覺上希望 Timebar 最多畫幾條 bar

// 動態 bins:起點 = 資料真正最小的 timestamp,終點 = MIN(資料 max, 72h)
const buildQuery = (dataUrl: string) => `
  WITH agent_ranges AS (
    SELECT
      list_min(timestamps) AS t_start,
      list_max(timestamps) AS t_end
    FROM read_parquet('${dataUrl}')
  ),
  bounds AS (
    SELECT
      CAST(MIN(t_start) AS BIGINT) AS data_min,
      LEAST(CAST(MAX(t_end) AS BIGINT), ${HARD_MAX_SEC}) AS data_max
    FROM agent_ranges
  ),
  bins AS (
    SELECT unnest(generate_series(
      (SELECT data_min FROM bounds),
      (SELECT data_max FROM bounds),
      ${BIN_SIZE}
    )) AS bin_start
  )
  SELECT
    b.bin_start AS time_bin,
    COUNT(*) AS count
  FROM bins b
  CROSS JOIN agent_ranges a
  WHERE
    a.t_end >= b.bin_start AND
    a.t_start < (b.bin_start + ${BIN_SIZE})
  GROUP BY b.bin_start
  ORDER BY b.bin_start ASC;
`;

export const TimeLine = () => {
  // 🌟 把原本的 useGlobalTimer 和 dispatch 換成 Zustand
  const {
    viewTimeRange,
    displayTimeRange,
    timeRange,
    setTimeRange,
    setDisplayTimeRange,
    setIsPlaying,
    setViewTimeRange,
    setTime,
  } = useMapStore(useShallow((state) => ({
    viewTimeRange: state.viewTimeRange,
    displayTimeRange: state.displayTimeRange,
    timeRange: state.timeRange,
    setTimeRange: state.setTimeRange,
    setDisplayTimeRange: state.setDisplayTimeRange,
    setIsPlaying: state.setIsPlaying,
    setViewTimeRange: state.setViewTimeRange,
    setTime: state.setTime,
  })));

  // Timebar 只在有軌跡資料（dataUrl 非 null）時才會被 MainView 掛載，這裡的 ?? '' 只是滿足型別
  const { dataUrl } = useResolvedFiles();
  const query = buildQuery(dataUrl ?? '');

  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<string | null>(null); 
  // 【白色把手已停用】目前被抓住的把手（給白色把手「拖曳中加亮」用；isDragging 是 ref，改它不會重新渲染）。
  // 恢復白色把手時取消註解這一行（同時要把 useState 加回上面的 import）：
  // const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const lastValueRef = useRef(timeRange[0]);
  const animationFrameRef = useRef<number | null>(null);

  const { data: queryResult } = useSql<{ time_bin: number; count: number }>({ query });
  const duckData = queryResult?.arrowTable;

  const histogramBars = useMemo(() => {
    if (!duckData) return [];

    const rows: any[] = duckData.toArray().map((r: any) => r.toJSON());

    if (rows.length === 0) return [];

    const [startSec, endSec] = viewTimeRange;

    let currentBinSize = BIN_SIZE;
    let totalBars = Math.ceil((endSec - startSec) / currentBinSize);

    if (totalBars > MAX_BARS) {
      currentBinSize = (endSec - startSec) / MAX_BARS;
      totalBars = MAX_BARS;
    }

    const counts = new Float32Array(totalBars);
    let maxCount = 0;

    for (const row of rows) {
      const binTime = Number(row.time_bin); 
      const count = Number(row.count);
      const index = Math.floor((binTime - startSec) / currentBinSize);

      if (index >= 0 && index < totalBars) {
        counts[index] = count;
        if (count > maxCount) maxCount = count;
      }
    }

    return Array.from(counts, (c) => (maxCount > 0 ? c / maxCount : 0));
  }, [duckData, viewTimeRange]);

  const getPercent = (val: number) => ((val - viewTimeRange[0]) / (viewTimeRange[1] - viewTimeRange[0])) * 100;
  
  const leftDisplayPct = getPercent(displayTimeRange[0]);
  const widthDisplayPct = getPercent(displayTimeRange[1]) - leftDisplayPct;
  const leftPct = getPercent(timeRange[0]);
  const widthPct = getPercent(timeRange[1]) - leftPct;

  useEffect(() => {
    let minTime = 0;
    let maxTime = 0;
    let hasData = false;

    if (duckData && duckData.numRows > 0) {
      const timeBinCol = duckData.getChild('time_bin');
      if (timeBinCol) {
        minTime = Number(timeBinCol.get(0));
        maxTime = Number(timeBinCol.get(duckData.numRows - 1));
        hasData = true;
      }
    }

    if (hasData) {
      // 🌟 1. 設定絕對資料邊界 (View) 與 預設顯示視窗 (Display)
      //   maxTime 已經由 SQL 端 LEAST(..., HARD_MAX_SEC) 保證 ≤ HARD_MAX_SEC,
      //   再加上 BIN_SIZE 緩衝後仍可能跨過上限,所以這裡再 clamp 一次。
      const adjustedMax = Math.min(maxTime + BIN_SIZE, HARD_MAX_SEC);
      setViewTimeRange([minTime, adjustedMax]);
      setDisplayTimeRange([minTime, adjustedMax]); // 讓視窗一開始看見全貌

      // 🌟 2. 將藍色把手 (TimeRange) 移到資料最前端，並設定預設視窗寬度（15 分鐘）
      const initialEnd = Math.min(minTime + DEFAULT_TIME_WINDOW_SEC, adjustedMax);
      setTimeRange([minTime, initialEnd]);

      // 🌟 3. 將地圖的光束時間也移過去！(不再從 0 開始)
      setTime(initialEnd);
    }
  }, [duckData, setViewTimeRange, setDisplayTimeRange, setTimeRange, setTime]);

  const getValueFromClientX = (clientX: number, useStep = false) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const rawValue = viewTimeRange[0] + percent * (viewTimeRange[1] - viewTimeRange[0]);
    if (useStep) return Math.round(rawValue / step) * step;
    return rawValue;
  };

  const handlePointerDown = (e: React.PointerEvent, type: string) => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsPlaying(false); // 拖拉時暫停播放
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = type;
    // 【白色把手已停用】恢復時取消註解：
    // setActiveHandle(type);
    lastValueRef.current = getValueFromClientX(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDisplayTimeRangeMove = (e: React.PointerEvent) => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    const newVal = getValueFromClientX(e.clientX, true);
    let nextStart = displayTimeRange[0];
    let nextEnd = displayTimeRange[1];
  
    if (isDragging.current === 'display-start') {
      nextStart = Math.min(newVal, displayTimeRange[1] - step, timeRange[0]);
      nextStart = Math.max(viewTimeRange[0], nextStart);
    } else if (isDragging.current === 'display-end') {
      nextEnd = Math.max(newVal, displayTimeRange[0] + step, timeRange[1]);
      nextEnd = Math.min(viewTimeRange[1] - 1, nextEnd);
    }

    if (nextStart !== viewTimeRange[0] || nextEnd !== viewTimeRange[1]) {
      setDisplayTimeRange([nextStart, nextEnd]);
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

    const newVal = getValueFromClientX(e.clientX);
    animationFrameRef.current = requestAnimationFrame(() => {
      if (isDragging.current === 'range') {
        const delta = newVal - lastValueRef.current;
        if (Math.abs(delta) >= Number.EPSILON) {
          const [start, end] = timeRange;
          const width = end - start;
          let nextStart = start + delta;
          let nextEnd = end + delta;
  
          if (nextStart < displayTimeRange[0]) {
            nextStart = displayTimeRange[0];
            nextEnd = displayTimeRange[0] + width;
          } else if (nextEnd > displayTimeRange[1]) {
            nextEnd = displayTimeRange[1];
            nextStart = displayTimeRange[1] - width;
          }
  
          if (nextStart !== start || nextEnd !== end) {
            setTimeRange([nextStart, nextEnd]);
            setTime(nextEnd)
            lastValueRef.current = newVal;
          }
        }
        return;
      }

      /* 【白色把手已停用——拖曳「改變窗口寬度」的邏輯】詳見檔案下方「白色把手停用說明」。
         上面 'range'（整個窗口平移）的分支沒有動。恢復白色把手時取消註解這一段：
      let nextStart = timeRange[0];
      let nextEnd = timeRange[1];

      if (isDragging.current === 'start') {
        nextStart = Math.min(newVal, timeRange[1]);
        nextStart = Math.max(displayTimeRange[0], nextStart);
      } else if (isDragging.current === 'end') {
        nextEnd = Math.max(newVal, timeRange[0]);
        nextEnd = Math.min(displayTimeRange[1], nextEnd);
      }

      if (nextStart !== timeRange[0] || nextEnd !== timeRange[1]) {
        setTimeRange([nextStart, nextEnd]);
      }
      */
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    isDragging.current = null;
    // 【白色把手已停用】恢復時取消註解：
    // setActiveHandle(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // 畫面渲染邏輯保持完全一樣
  return (
    <div className="relative flex w-full touch-none select-none items-center" ref={trackRef}>
      <div className="relative h-8 w-full grow overflow-hidden bg-[#2B2B38] border border-slate-700 rounded-sm">
        <div className="absolute inset-0 flex items-end justify-between px-0.5 pb-0">
          <div className="absolute inset-0 flex items-end justify-between px-0.5 pb-0">
            {histogramBars.map((heightRatio, i) => (
              <div key={`bg-${i}`} className="flex-1 bg-slate-600/50 rounded-t-[1px]" style={{ height: `${Math.max(heightRatio * 100, 5)}%` }} />
            ))}
          </div>
          <div 
            className="absolute inset-0 flex items-end justify-between px-0.5 pb-0 gap-0 transition-none will-change-[clip-path]"
            style={{ clipPath: `inset(0 ${100 - (leftPct + widthPct)}% 0 ${leftPct}%)` }}
          >
            {histogramBars.map((heightRatio, i) => (
              <div key={`fg-${i}`} className="flex-1 rounded-t-[1px] bg-cyan-500" style={{ height: `${Math.max(heightRatio * 100, 5)}%` }} />
            ))}
          </div>
        </div>
        {/* 窗口本體（可整個左右拖曳平移，游標 grab；不能拉寬度）。樣式維持原本的淡灰填色 + 青色細邊；
            窗口的起點 / 終點由下面兩條「純視覺」的白色細條標示。
            minWidth 12px：15 分鐘的窗口只佔時間軸約 1%（約 11px），不設最小寬度會很難抓。 */}
        <div 
          className="absolute inset-y-0 bg-gray-600/20 border-x border-cyan-500/50 cursor-grab active:cursor-grabbing hover:bg-gray-600/30 transition-colors z-10 backdrop-blur-[0.5px]"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 12 }}
          onPointerDown={(e) => handlePointerDown(e, 'range')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
      {/* 最頭 / 最尾的灰色把手（顯示範圍 display-start / display-end）：刻意低調——視覺只是 2px 的細灰線，
          高度跟時間軸外框一樣（h-8，不再上下突出）；程式邏輯與 8px 寬的透明感應區都沒動。 */}
      {([['display-start', leftDisplayPct], ['display-end', leftDisplayPct + widthDisplayPct]] as const).map(([type, pct]) => (
        <div
          key={type}
          className="absolute z-20 flex h-8 w-2 cursor-col-resize justify-center"
          style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
          onPointerDown={(e) => handlePointerDown(e, type)}
          onPointerMove={handleDisplayTimeRangeMove}
          onPointerUp={handlePointerUp}
        >
          <span className="pointer-events-none block h-full w-0.5 bg-slate-500/70" />
        </div>
      ))}
      {/* 窗口起點 / 終點的白色細條——純視覺（pointer-events-none，不能拖曳、不改變寬度；寬度只用 Time window 按鈕）。
          樣式沿用調細後的白色把手：視覺 4px、比時間軸外框上下各多 4px（h-10）、slate-200、1px 深色描邊。
          放在灰色把手之後，所以窗口在時間軸最左邊時，白色細條會畫在灰色細線上面，不會被蓋住。 */}
      {[leftPct, leftPct + widthPct].map((pct, i) => (
        <span
          key={i}
          className="pointer-events-none absolute z-30 block h-10 w-1 rounded-sm bg-slate-200 shadow-[0_0_0_1px_rgba(15,23,42,0.9)]"
          style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
        />
      ))}
      {/* ──────────── 白色把手停用說明 ────────────
          為什麼停用：窗口寬度現在只用 Time window 按鈕（15 / 30 / 60 分鐘）調整；
          「按鈕」與「拖曳把手」兩種調整方式並存太複雜，而且在時間軸起點處，白色把手會和灰色的顯示範圍把手重疊。
          停用範圍：只有下面這兩個白色把手（窗口起點 / 終點）與它們的「改變窗口寬度」拖曳邏輯。
          沒有動到：窗口本體（整個窗口左右平移，handlePointerDown(e, 'range')）、灰色的顯示範圍把手（display-start / display-end）、
          Time window 按鈕。
          如何恢復（四處一起恢復）：
            1. 取消註解下面這段 JSX（兩個白色把手的 .map）；
            2. 取消註解 handlePointerMove 裡標示「白色把手已停用」的那一段（nextStart / nextEnd 的計算與 setTimeRange）；
            3. 取消註解 const [activeHandle, setActiveHandle] = useState(...)，以及 handlePointerDown / handlePointerUp 裡
               被註解的 setActiveHandle(type) / setActiveHandle(null)；
            4. 檔案最上面的 import 改回含 useState 的那一行。
          恢復時把手為已調細的樣式（視覺約 4px、感應區 12px 以上）：視覺細條 w-1（4px），外層透明感應區 w-3（12px），
          hover 或拖曳中從 slate-200 變純白並加外發光；原本（調細之前）是 8px 寬、帶 1px 深色邊。 */}
      {/*
      {([['start', leftPct], ['end', leftPct + widthPct]] as const).map(([type, pct]) => {
        const active = activeHandle === type;
        return (
          <div
            key={type}
            className="group absolute z-20 flex h-10 w-3 cursor-col-resize items-stretch justify-center"
            style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
            onPointerDown={(e) => handlePointerDown(e, type)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <span
              className={`pointer-events-none block w-1 rounded-sm shadow-[0_0_0_1px_rgba(15,23,42,0.9)] transition-[background-color,box-shadow] ${
                active
                  ? 'bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.9),0_0_8px_2px_rgba(255,255,255,0.7)]'
                  : 'bg-slate-200 group-hover:bg-white group-hover:shadow-[0_0_0_1px_rgba(15,23,42,0.9),0_0_6px_1px_rgba(255,255,255,0.6)]'
              }`}
            />
          </div>
        );
      })}
      */}
    </div>
  )
}
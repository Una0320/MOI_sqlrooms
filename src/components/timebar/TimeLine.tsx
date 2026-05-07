import { useEffect, useMemo, useRef } from "react";
import { useMapStore } from "@/zustand/useMapStore";
import { useDuckDBTable } from "@/duckdb/useDuckDBTable";
import { useShallow } from "@sqlrooms/room-shell";

// 🌟 對準你的本地端 API
const fileName = import.meta.env.VITE_DUCKDB_FILE_NAME || 'abm_format_outcome_20000.parquet';
const baseUrl = import.meta.env.VITE_DUCKDB_CONNECTION_STRING || 'http://localhost:7780/data';
const url = new URL(fileName, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').href;

const BIN_SIZE = 60;
const step = 10 * 60; // 10 mins

const query = `
  WITH agent_ranges AS (
    SELECT 
      list_min(timestamps) as t_start,
      list_max(timestamps) as t_end
    FROM '${fileName}'
  ),
  bins AS (
    SELECT unnest(generate_series(0, 86400, ${BIN_SIZE})) as bin_start
  )
  SELECT 
    b.bin_start as time_bin,
    COUNT(*) as count
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
    setTime          
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

  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<string | null>(null); 
  const lastValueRef = useRef(timeRange[0]);
  const animationFrameRef = useRef<number | null>(null);

  const { data: duckData } = useDuckDBTable(fileName, url, query);

  const histogramBars = useMemo(() => {
    if (!duckData) return [];

    // 支援 Array 或 Arrow Table 的萬用解析法
    let rows: any[] = [];
    if (Array.isArray(duckData)) {
      rows = duckData;
    } else if (typeof (duckData as any).numRows !== 'undefined') {
      rows = (duckData as any).toArray().map((r: any) => r.toJSON());
    }

    if (rows.length === 0) return [];

    const [startSec, endSec] = viewTimeRange;

    let currentBinSize = BIN_SIZE;
    let totalBars = Math.ceil((endSec - startSec) / currentBinSize);
    
    const MAX_BARS = 250;
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
    // 萬用取值器：處理 Array 或 Arrow Table
    let minTime = 0;
    let maxTime = 0;
    let hasData = false;

    if (Array.isArray(duckData) && duckData.length > 0) {
      minTime = Number(duckData[0].time_bin);
      maxTime = Number(duckData[duckData.length - 1].time_bin);
      hasData = true;
    } else if (duckData && typeof (duckData as any).numRows !== 'undefined' && (duckData as any).numRows > 0) {
      const timeBinCol = (duckData as any).getChild('time_bin');
      if (timeBinCol) {
        minTime = Number(timeBinCol.get(0));
        maxTime = Number(timeBinCol.get((duckData as any).numRows - 1));
        hasData = true;
      }
    }

    if (hasData) {
      // 🌟 1. 設定絕對資料邊界 (View) 與 預設顯示視窗 (Display)
      const adjustedMax = maxTime + BIN_SIZE;
      setViewTimeRange([minTime, adjustedMax]);
      setDisplayTimeRange([minTime, adjustedMax]); // 讓視窗一開始看見全貌

      // 🌟 2. 將藍色把手 (TimeRange) 移到資料最前端，並設定 30 分鐘寬度
      const INITIAL_WINDOW_SEC = 1800; // 30分鐘
      const initialEnd = Math.min(minTime + INITIAL_WINDOW_SEC, adjustedMax);
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
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    isDragging.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // 畫面渲染邏輯保持完全一樣
  return (
    <div className="relative flex w-full touch-none select-none items-center" ref={trackRef}>
      <div className="relative h-12 w-full grow overflow-hidden bg-[#2B2B38] border border-slate-700 rounded-sm">
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
        <div 
          className="absolute inset-y-0 bg-gray-600/20 border-x border-cyan-500/50 cursor-grab active:cursor-grabbing hover:bg-gray-600/30 transition-colors z-10 backdrop-blur-[0.5px]"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={(e) => handlePointerDown(e, 'range')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
      <div
        className="absolute block h-14 w-2 border border-slate-900 bg-slate-500 cursor-col-resize z-20"
        style={{ left: `${leftDisplayPct}%`, transform: 'translateX(-50%)' }}
        onPointerDown={(e) => handlePointerDown(e, 'display-start')}
        onPointerMove={handleDisplayTimeRangeMove}
        onPointerUp={handlePointerUp}
      />
      <div
        className="absolute block h-14 w-2 border border-slate-900 bg-slate-500 cursor-col-resize z-20"
        style={{ left: `${leftDisplayPct + widthDisplayPct}%`, transform: 'translateX(-50%)' }}
        onPointerDown={(e) => handlePointerDown(e, 'display-end')}
        onPointerMove={handleDisplayTimeRangeMove}
        onPointerUp={handlePointerUp}
      />
      <div
        className="absolute block h-14 w-2 border border-slate-900 bg-white shadow-sm hover:scale-110 cursor-col-resize z-20 transition-transform"
        style={{ left: `${leftPct}%`, transform: 'translateX(-50%)' }}
        onPointerDown={(e) => handlePointerDown(e, 'start')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div
        className="absolute block h-14 w-2 border border-slate-900 bg-white shadow-sm hover:scale-110 cursor-col-resize z-20 transition-transform"
        style={{ left: `${leftPct + widthPct}%`, transform: 'translateX(-50%)' }}
        onPointerDown={(e) => handlePointerDown(e, 'end')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  )
}
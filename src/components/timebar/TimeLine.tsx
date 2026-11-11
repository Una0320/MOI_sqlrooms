import { useEffect, useMemo, useRef, useState } from "react";
import { useMapStore, DEFAULT_TIME_WINDOW_SEC } from "@/zustand/useMapStore";
import { useSql } from "@sqlrooms/duckdb";
import { useShallow } from "@sqlrooms/room-shell";
import { EVAC_TRANSIT_BIN_SEC, EVAC_TRANSIT_TABLE, useEvacTablesReady } from "@/hooks/useEvacArrivalsView";
import { AGENT_MODE_TRIP_COLORS } from "@/constants/map";
import { MIN_BAR_FRACTION, STACK_MODE_BITS, binBars, buildTransitGrid, selectBars } from "./transitHistogram";

const BIN_SIZE = EVAC_TRANSIT_BIN_SEC; // 直方圖粒度:60 秒一格,必須與 evac_transit 表的格寬一致(JS 端再做視覺重取樣)
const HARD_MAX_SEC = 72 * 3600; // 顯示上限:72:00:00(模擬約到警報後 69 小時、最晚抵達約 46 小時)
const step = 10 * 60;           // 滑桿的吸附步長:10 分鐘
const MAX_BARS = 50;            // 視覺上希望 Timebar 最多畫幾條 bar

// 直方圖資料 = evac_transit 表（hooks/useEvacArrivalsView.ts 建，與折線圖、Evac Rate 共用同一次 parquet 掃描）：
// 每個運具「在途人數」（已出發、尚未抵達，包含停在站上等車；單位是人，n_persons 加權）的階梯函數。
// 表建好之前查零列（hook 不能條件式呼叫），這時不畫長條。切換 selectedModes 完全不碰 SQL，只重算長條高度。
const TRANSIT_QUERY = `SELECT t, mode, persons FROM ${EVAC_TRANSIT_TABLE} ORDER BY mode, t`;
const EMPTY_QUERY = 'SELECT CAST(NULL AS INTEGER) AS t, CAST(NULL AS UTINYINT) AS mode, CAST(NULL AS INTEGER) AS persons WHERE false';
const BAR_RGB = STACK_MODE_BITS.map((bit) => {
  const [r, g, b] = AGENT_MODE_TRIP_COLORS[Math.log2(bit)]; // 顏色表的索引 = log2(運具 bit)：WALK 0、CAR 1、BUS 3、RAIL 4
  return `rgb(${r} ${g} ${b})`;
});

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
    selectedModes,
  } = useMapStore(useShallow((state) => ({
    viewTimeRange: state.viewTimeRange,
    displayTimeRange: state.displayTimeRange,
    timeRange: state.timeRange,
    setTimeRange: state.setTimeRange,
    setDisplayTimeRange: state.setDisplayTimeRange,
    setIsPlaying: state.setIsPlaying,
    setViewTimeRange: state.setViewTimeRange,
    setTime: state.setTime,
    selectedModes: state.selectedModes,
  })));

  const tablesReady = useEvacTablesReady();

  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<string | null>(null); 
  // 【白色把手已停用】目前被抓住的把手（給白色把手「拖曳中加亮」用；isDragging 是 ref，改它不會重新渲染）。
  // 恢復白色把手時取消註解這一行（同時要把 useState 加回上面的 import）：
  // const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const lastValueRef = useRef(timeRange[0]);
  // 播放頭握把是否正在被拖曳（給握把的外環 / 游標用；isDragging 是 ref，改它不會重新渲染）
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  const { data: queryResult } = useSql<{ t: number; mode: number; persons: number }>({
    query: tablesReady ? TRANSIT_QUERY : EMPTY_QUERY,
  });
  const duckData = queryResult?.arrowTable;

  // 時間格 × 運具 的 typed array；只在資料（情境 / 抽樣量）變動時重算一次
  const grid = useMemo(() => {
    if (!duckData || duckData.numRows === 0) return null;
    const t = duckData.getChild('t')?.toArray() as ArrayLike<number> | undefined;
    const mode = duckData.getChild('mode')?.toArray() as ArrayLike<number> | undefined;
    const persons = duckData.getChild('persons')?.toArray() as ArrayLike<number> | undefined;
    if (!t || !mode || !persons) return null;
    return buildTransitGrid(t, mode, persons, BIN_SIZE);
  }, [duckData]);

  // 每根長條取「格內 60 秒樣本的平均同時在途人數」（四運具各自平均）。只在資料或檢視範圍變動時算一次。
  const binned = useMemo(
    () => (grid ? binBars(grid, viewTimeRange[0], viewTimeRange[1], BIN_SIZE, MAX_BARS) : null),
    [grid, viewTimeRange],
  );
  // 每根長條 4 個運具的高度（佔「四運具全選時最大總高」的比例）。切換 selectedModes 只會重跑這裡（typed array 運算），不碰 SQL。
  // 分母固定為全選時的最大值，所以取消某運具時長條會真的變矮。
  const bars = useMemo(() => (binned ? selectBars(binned, selectedModes) : null), [binned, selectedModes]);

  const getPercent = (val: number) => ((val - viewTimeRange[0]) / (viewTimeRange[1] - viewTimeRange[0])) * 100;
  
  const leftDisplayPct = getPercent(displayTimeRange[0]);
  const widthDisplayPct = getPercent(displayTimeRange[1]) - leftDisplayPct;
  const leftPct = getPercent(timeRange[0]);
  const widthPct = getPercent(timeRange[1]) - leftPct;

  useEffect(() => {
    // 時間軸起點固定為警報時刻 0；終點 = 資料最後一個時間格（≤ HARD_MAX_SEC）
    const minTime = 0;
    const hasData = grid !== null;
    const maxTime = grid ? Math.min((grid.nBins - 1) * grid.binSec, HARD_MAX_SEC) : 0;

    if (hasData) {
      // 🌟 1. 設定絕對資料邊界 (View) 與 預設顯示視窗 (Display)
      //   maxTime 已 clamp 在 HARD_MAX_SEC 以內,再加上 BIN_SIZE 緩衝後可能跨過上限,所以這裡再 clamp 一次。
      const adjustedMax = Math.min(maxTime + BIN_SIZE, HARD_MAX_SEC);
      setViewTimeRange([minTime, adjustedMax]);
      setDisplayTimeRange([minTime, adjustedMax]); // 讓視窗一開始看見全貌

      // 🌟 2. 將藍色把手 (TimeRange) 移到資料最前端，並設定預設視窗寬度（15 分鐘）
      const initialEnd = Math.min(minTime + DEFAULT_TIME_WINDOW_SEC, adjustedMax);
      setTimeRange([minTime, initialEnd]);

      // 🌟 3. 將地圖的光束時間也移過去！(不再從 0 開始)
      setTime(initialEnd);
    }
  }, [grid, setViewTimeRange, setDisplayTimeRange, setTimeRange, setTime]);

  const getValueFromClientX = (clientX: number, useStep = false) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const rawValue = viewTimeRange[0] + percent * (viewTimeRange[1] - viewTimeRange[0]);
    if (useStep) return Math.round(rawValue / step) * step;
    return rawValue;
  };

  // 圖表繪製區（扣掉外框各 1px）內的時間，讓握把 / 終點線 / 色帶用同一把尺（外框 1px 的差在長時間軸上約 130 秒）
  const getInnerValueFromClientX = (clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.min(1, Math.max(0, (clientX - rect.left - 1) / Math.max(1, rect.width - 2)));
    return viewTimeRange[0] + percent * (viewTimeRange[1] - viewTimeRange[0]);
  };

  // 播放頭：窗口終點 = value、起點 = 終點 − 窗口寬度（寬度只由 Time window 按鈕決定，這裡不改）。
  // 拖曳 / 點擊範圍限制在目前顯示的時間軸內，起點不會小於時間軸起點（0）。Time 與 Evac Rate 都跟著終點走。
  const seekTo = (value: number) => {
    const width = timeRange[1] - timeRange[0];
    const lo = displayTimeRange[0] + width;
    const hi = Math.max(lo, displayTimeRange[1]);
    const end = Math.min(hi, Math.max(lo, value));
    if (end !== timeRange[1]) {
      setTimeRange([end - width, end]);
      setTime(end);
    }
  };

  const handlePointerDown = (e: React.PointerEvent, type: string) => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsPlaying(false); // 拖拉時暫停播放
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = type;
    if (type === 'playhead') setPlayheadDragging(true);
    // 【白色把手已停用】恢復時取消註解：
    // setActiveHandle(type);
    lastValueRef.current = getValueFromClientX(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
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

    const clientXRef = e.clientX; // rAF 回呼裡不能再讀 e（React 事件物件）
    animationFrameRef.current = requestAnimationFrame(() => {
      if (isDragging.current === 'playhead') {
        seekTo(getInnerValueFromClientX(clientXRef));
        return;
      }

      /* 【舊的「整個窗口平移」拖曳——已被播放頭取代】恢復舊窗口本體（見檔案下方說明）時取消註解這一段，
         並把上面 'playhead' 的分支拿掉（還要在 handlePointerMove 開頭加回 const newVal = getValueFromClientX(e.clientX);，
         下面兩段被註解的邏輯都會用到 newVal）：
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
      */

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
    setPlayheadDragging(false);
    // 【白色把手已停用】恢復時取消註解：
    // setActiveHandle(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // 一根長條 = 四個運具區段堆疊（自下而上 WALK、CAR、BUS、RAIL）。沒勾選或人數 0 的區段不畫，上方的自動往下收合；
  // 整根總高低於 MIN_BAR_FRACTION 時等比例放大到該高度（區段比例不變）；非零區段至少 1px，整根被容器裁切、不會超出。
  // dim = 時間窗口以外的部分（同樣的長條，只是變淡）。
  const renderBars = (dim: boolean) => {
    if (!bars) return null;
    const out = [];
    for (let i = 0; i < bars.nBars; i++) {
      const base = i * 4;
      const total = bars.seg[base] + bars.seg[base + 1] + bars.seg[base + 2] + bars.seg[base + 3];
      if (total <= 0) {
        out.push(<div key={i} className="flex-1" />); // 空長條只佔位，維持間距
        continue;
      }
      out.push(
        <div
          key={i}
          className="flex flex-1 flex-col-reverse overflow-hidden rounded-t-[1px]"
          style={{ height: `${Math.max(total, MIN_BAR_FRACTION) * 100}%`, opacity: dim ? 0.4 : 1 }}
        >
          {STACK_MODE_BITS.map((bit, m) => {
            const v = bars.seg[base + m];
            return v > 0 ? <div key={bit} style={{ flexGrow: v, flexBasis: 0, minHeight: 1, backgroundColor: BAR_RGB[m] }} /> : null;
          })}
        </div>,
      );
    }
    return out;
  };

  // 畫面渲染邏輯保持完全一樣（只有長條內容改成依運具堆疊）
  return (
    <div className="relative flex w-full touch-none select-none items-center" ref={trackRef}>
      <div
        className="relative h-8 w-full grow cursor-pointer overflow-hidden bg-[#2B2B38] border border-slate-700 rounded-sm"
        // 圖表區任意位置按下 = 跳到該處（以點擊位置為窗口終點），按住不放可以接著拖；跟握把共用 'playhead' 拖曳
        onPointerDown={(e) => {
          handlePointerDown(e, 'playhead');
          seekTo(getInnerValueFromClientX(e.clientX));
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        data-chart
      >
        <div className="absolute inset-0 flex items-end justify-between px-0.5 pb-0">
          <div className="absolute inset-0 flex items-end justify-between px-0.5 pb-0">
            {renderBars(true)}
          </div>
          <div 
            className="absolute inset-0 flex items-end justify-between px-0.5 pb-0 gap-0 transition-none will-change-[clip-path]"
            style={{ clipPath: `inset(0 ${100 - (leftPct + widthPct)}% 0 ${leftPct}%)` }}
          >
            {renderBars(false)}
          </div>
        </div>
        {/* 時間窗口 = 半透明白色色帶（涵蓋 [窗口起點, 窗口終點]，整個圖表高度，約 22% 不透明）＋ 窗口終點的 2px 白色垂直線。
            純視覺（pointer-events-none）；互動全在下面的播放頭握把，以及整個圖表區的「點擊跳到該處」。
            窗口寬度仍只由 Time window 按鈕（15 / 30 / 60 分鐘）決定。 */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 bg-white/[0.22]"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          data-window-band
        />
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white"
          style={{ left: `${leftPct + widthPct}%`, transform: 'translateX(-50%)' }}
          data-playhead-line
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
      {/* 播放頭握把：窗口終點（也就是 Time 與 Evac Rate 用的時間）上方的圓形握把。白色圓、2px 深色外圈，直徑 12px，
          中心比圖表區上緣低 4px（所以略凸出，凸出量 ≤ Timebar 標題列與圖表區之間的 8px 間距，不會蓋到標題，也不增加總高）。
          透明感應區 28px。hover：放大到約 15px、游標 grab；拖曳中：游標 grabbing、加 2px #DF9651 外環。
          拖曳改變窗口終點，起點 = 終點 − 窗口寬度，且不小於時間軸起點。放在灰色顯示範圍把手之後（z-30），不會被蓋住。 */}
      <div
        className={`group absolute z-30 flex h-7 w-7 items-center justify-center ${playheadDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ left: `calc(1px + (100% - 2px) * ${(leftPct + widthPct) / 100})`, top: 4, transform: 'translate(-50%, -50%)' }}
        onPointerDown={(e) => handlePointerDown(e, 'playhead')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        data-playhead-handle
      >
        <span
          className={`pointer-events-none block h-3 w-3 rounded-full bg-white transition-[transform,box-shadow] ${
            playheadDragging
              ? 'scale-125 shadow-[0_0_0_2px_#1e1e24,0_0_0_4px_#DF9651]'
              : 'shadow-[0_0_0_2px_#1e1e24] group-hover:scale-125'
          }`}
        />
      </div>
      {/* ──────────── 舊的窗口樣式（已被播放頭取代，以註解保留）────────────
          之前的窗口 = 可整個左右拖曳平移的灰色窗口本體 + 兩條「純視覺」的白色細條（窗口起點 / 終點）；
          現在換成：半透明白色色帶 + 終點白線 + 圓形播放頭握把 + 點擊跳轉（見上面）。窗口寬度仍只由 Time window 按鈕決定。
          如何恢復舊樣式：
            1. 把上面的色帶 / 終點線 / 播放頭握把 JSX 換回下面註解裡的「窗口本體」與「白色細條」；
            2. 圖表區容器（data-chart）拿掉 onPointerDown / onPointerMove / onPointerUp（點擊跳轉）；
            3. handlePointerMove 裡把 'playhead' 分支換回被註解的 'range' 分支（整個窗口平移）。
          舊窗口本體（淡灰填色 + 青色細邊，游標 grab，onPointerDown 走 'range'）：
            <div className="absolute inset-y-0 bg-gray-600/20 border-x border-cyan-500/50 cursor-grab active:cursor-grabbing hover:bg-gray-600/30 transition-colors z-10 backdrop-blur-[0.5px]"
                 style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 12 }}
                 onPointerDown={(e) => handlePointerDown(e, 'range')} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
          舊的白色細條（純視覺，視覺 4px、比圖表區上下各多 4px）：
            {[leftPct, leftPct + widthPct].map((pct, i) => (
              <span key={i} className="pointer-events-none absolute z-30 block h-10 w-1 rounded-sm bg-slate-200 shadow-[0_0_0_1px_rgba(15,23,42,0.9)]"
                    style={{ left: `${pct}%`, transform: 'translateX(-50%)' }} />
            ))}
      */}
      {/* ──────────── 白色把手停用說明 ────────────
          為什麼停用：窗口寬度現在只用 Time window 按鈕（15 / 30 / 60 分鐘）調整；
          「按鈕」與「拖曳把手」兩種調整方式並存太複雜，而且在時間軸起點處，白色把手會和灰色的顯示範圍把手重疊。
          停用範圍：只有下面這兩個白色把手（窗口起點 / 終點）與它們的「改變窗口寬度」拖曳邏輯。
          沒有動到：灰色的顯示範圍把手（display-start / display-end）、
          Time window 按鈕。
          如何恢復（四處一起恢復）：
            1. 取消註解下面這段 JSX（兩個白色把手的 .map）；
            2. 取消註解 handlePointerMove 裡標示「白色把手已停用」的那一段（nextStart / nextEnd 的計算與 setTimeRange）；
            3. 取消註解 const [activeHandle, setActiveHandle] = useState(...)，以及 handlePointerDown / handlePointerUp 裡
               被註解的 setActiveHandle(type) / setActiveHandle(null)；
            4. （import 已含 useState，不用再改；注意播放頭用的 state 叫 playheadDragging，別撞名。）
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
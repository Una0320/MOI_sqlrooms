import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Minus, Plus } from 'lucide-react';
import { useSql } from '@sqlrooms/duckdb';
import { vg, VgPlotChart } from '@sqlrooms/mosaic';
import type { MosaicSliceState } from '../mosaicTypes';
import { useBaseRoomStore } from '@sqlrooms/room-shell';
import { useMapStore } from '@/zustand/useMapStore';
import { NO_DATA_HINT } from '../constants/data';
import { PANEL_FRAME } from '../constants/layout';
import { AGENT_MODE_TRIP_COLORS, MOBILITY_MODE_BITS, ORDERED_MOBILITY_MODES } from '../constants/map';
import { EVAC_CURVE_ALL_TABLE, EVAC_CURVE_TABLE, useEvacTablesReady } from '../hooks/useEvacArrivalsView';
import { useResolvedFiles } from '../hooks/useResolvedFiles';

// 取代右側 Mobility Modes 面板：分運具 Evac Rate 折線圖，圖例即過濾。
//
// 唯一真相來源仍是 useMapStore.selectedModes：圖例色塊與「點折線」兩個入口都只呼叫 toggleMode(bit)；
// shader bitmask、Points、OD Arc、Heatmap 都不動，也不用 Mosaic Selection 當運具過濾（所以切換不會觸發任何 SQL）。
//
// 資料：evac_curve（四個運具，每 60 秒一格的累計完成率 %）與 evac_curve_all（所有 agent，與左上 Evac Rate 一致），
// 兩張表由 hooks/useEvacArrivalsView.ts 建立。圖用 vg.plot 直接讀表，走 SQLRooms 的同一個 DuckDB 連線。
// 這個檔案整個是 lazy 載入（MainView.tsx），Mosaic plot 相關程式碼只在要顯示時才進來。
//
// ⚠ 地圖運具過濾是「逐段」（取消 BUS 只隱藏公車段），這張圖是「逐 agent」（依搭乘最遠的運具歸類，
//   RAIL > BUS > CAR > WALK），兩者語意不同，刻意不統一。
//
// 如何恢復舊的 Mobility Modes 面板：MainView.tsx 把 <EvacModePanel /> 換回 <ModeSelector />（元件檔案還在）。

// hover 說明：換行用 \n（原生 title 會照換行顯示）
const EVAC_INFO_TITLE = [
  'Y 軸：累計完成率（%）= 該運具的人中，到該時間為止已抵達的比例（人數加權）。每條線各除以自己的總數，所以都會到 100%。',
  '分類：每個 agent 只算一次，歸入搭乘最遠的運具（RAIL > BUS > CAR > WALK）；轉乘者歸入轉乘後的運具，WALK 只含純步行者。',
  '虛線「全部」：所有 agent，與左上角 Evac Rate 一致。',
  '注意：地圖的運具過濾是逐段，與此圖逐 agent 的分類不同。',
].join('\n');

const MODE_NAMES = ['WALK', 'CAR', 'BUS', 'RAIL'] as const;
type ModeName = (typeof MODE_NAMES)[number];

const ALL_COLOR = '#DF9651'; // 與左上 Evac Rate 數值同色
const CHART_W = 260; // 面板 284 - 左右 padding 12*2
const CHART_H = 160;
const MARGIN = { left: 34, right: 10, top: 6, bottom: 20 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;

const toHex = ([r, g, b]: number[]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// 顏色一律取自 AGENT_MODE_TRIP_COLORS（用 log2(bit) 對照，同 ModeSelector），不另寫一份
const MODE_HEX: Record<ModeName, string> = Object.fromEntries(
  MODE_NAMES.map((name) => {
    const bit = MOBILITY_MODE_BITS[name.toLowerCase() as keyof typeof MOBILITY_MODE_BITS];
    return [name, toHex(AGENT_MODE_TRIP_COLORS[Math.floor(Math.log2(bit))] ?? [255, 255, 255])];
  }),
) as Record<ModeName, string>;
const HEX_TO_MODE: Record<string, ModeName> = Object.fromEntries(MODE_NAMES.map((m) => [MODE_HEX[m], m]));

const modeBit = (name: ModeName) => MOBILITY_MODE_BITS[name.toLowerCase() as keyof typeof MOBILITY_MODE_BITS];

const fmtHHMM = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// 刻度：整點，最多約 5 個
const tickValues = (tmax: number): number[] => {
  const hours = tmax / 3600;
  const step = [1, 2, 3, 4, 6, 12, 24].find((s) => hours / s <= 5) ?? 24;
  const out: number[] = [];
  for (let h = 0; h * 3600 <= tmax; h += step) out.push(h * 3600);
  return out;
};

// 播放位置：只訂閱 time 的小元件，疊在圖上，依固定的 margin 與 x domain 定位，不重繪 Mosaic plot
const Playhead = ({ tmax }: { tmax: number }) => {
  const time = useMapStore((s) => s.time);
  const x = MARGIN.left + Math.min(Math.max(time / tmax, 0), 1) * PLOT_W;
  return (
    <div
      data-testid="evac-playhead"
      className="pointer-events-none absolute w-px bg-white/80"
      style={{ left: 0, top: MARGIN.top, height: CHART_H - MARGIN.top - MARGIN.bottom, transform: `translateX(${x}px)` }}
    />
  );
};

const Chart = ({ tmax }: { tmax: number }) => {
  const selectedModes = useMapStore((s) => s.selectedModes);
  const toggleMode = useMapStore((s) => s.toggleMode);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ mode: ModeName; x: number; y: number } | null>(null);

  // vg.plot 立即回傳元素，資料由 Mosaic 非同步查回來後填進 SVG；tmax 變（換情境）就重建
  const plot = useMemo(() => {
    const curve = vg.from(EVAC_CURVE_TABLE);
    const common = { x: 't', y: 'pct', curve: 'step-after' } as const;
    return vg.plot(
      vg.lineY(curve, { ...common, z: 'mode', stroke: 'mode', strokeWidth: 1.5 }),
      // 「全部」：虛線，不可點擊、不參與開關
      vg.lineY(vg.from(EVAC_CURVE_ALL_TABLE), {
        ...common,
        stroke: ALL_COLOR,
        strokeWidth: 1.5,
        strokeDasharray: '4 3',
      }),
      // 點擊用的透明粗線（約 12px hit area），畫在最上層
      vg.lineY(curve, { ...common, z: 'mode', stroke: 'mode', strokeWidth: 12, strokeOpacity: 0 }),
      vg.colorDomain([...MODE_NAMES]),
      vg.colorRange(MODE_NAMES.map((m) => MODE_HEX[m])),
      vg.xDomain([0, tmax]),
      vg.yDomain([0, 100]),
      vg.width(CHART_W),
      vg.height(CHART_H),
      vg.marginLeft(MARGIN.left),
      vg.marginRight(MARGIN.right),
      vg.marginTop(MARGIN.top),
      vg.marginBottom(MARGIN.bottom),
      vg.xTicks(tickValues(tmax)),
      vg.xTickFormat(fmtHHMM),
      vg.yTicks(4),
      vg.yTickFormat((d: number) => `${d}%`),
      vg.xLabel(null),
      vg.yLabel(null),
      vg.yGrid(true),
      vg.style({ fontSize: '10px', background: 'transparent', color: '#cbd5e1' }),
    );
  }, [tmax]);

  // plot 被丟掉時（換情境 / 收合）解除它在 Mosaic coordinator 上註冊的 client
  useEffect(() => () => (plot as unknown as { destroy?: () => void }).destroy?.(), [plot]);

  // 把「選取狀態 / hover」套到渲染出來的 SVG：被關閉的線降到 0.25 透明度（仍可點）、hover 的線加粗。
  // 只動 DOM 樣式，不重繪 plot、不查詢；Mosaic 資料回來後會重畫 path，所以用 MutationObserver 重新套用。
  const hoverMode = hover?.mode ?? null;
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const apply = () => {
      // ⚠ vgplot 會把 mark 選項裡的字串當成「資料欄位名」去查（className: 'x' 會變成 SELECT "x"），所以不能用 className
      // 區分三個 mark；改成 plot 渲染後依 <g aria-label="line"> 的順序（= 上面 vg.plot 裡三個 lineY 的順序）自己標 class。
      const gs = root.querySelectorAll('g[aria-label="line"]');
      if (gs.length >= 3) {
        gs[0].classList.add('evac-vis');
        gs[1].classList.add('evac-all');
        gs[2].classList.add('evac-hit');
      }
      root.querySelectorAll<SVGPathElement>('.evac-vis path').forEach((p) => {
        const m = HEX_TO_MODE[(p.getAttribute('stroke') ?? '').toLowerCase()];
        if (!m) return;
        const on = selectedModes.includes(modeBit(m));
        p.style.strokeOpacity = on ? '1' : '0.25';
        p.style.strokeWidth = hoverMode === m ? '3' : '1.5';
      });
      root.querySelectorAll<SVGPathElement>('.evac-hit path').forEach((p) => {
        p.style.pointerEvents = 'stroke';
        p.style.cursor = 'pointer';
      });
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [selectedModes, hoverMode, plot]);

  const modeAt = (e: React.PointerEvent | React.MouseEvent): ModeName | null => {
    const el = e.target as Element;
    if (!el.closest?.('.evac-hit')) return null;
    return HEX_TO_MODE[(el.getAttribute('stroke') ?? '').toLowerCase()] ?? null;
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      style={{ width: CHART_W, height: CHART_H }}
      data-testid="evac-chart"
      onPointerMove={(e) => {
        const m = modeAt(e);
        if (!m) return setHover(null);
        const r = e.currentTarget.getBoundingClientRect();
        setHover({ mode: m, x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const m = modeAt(e);
        if (m) toggleMode(modeBit(m));
      }}
    >
      <VgPlotChart plot={plot} />
      <Playhead tmax={tmax} />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-white/15 bg-black/80 px-1.5 py-0.5 text-[11px] text-white"
          style={{ left: Math.min(hover.x + 8, CHART_W - 90), top: Math.max(hover.y - 24, 0) }}
        >
          {hover.mode}
          {selectedModes.includes(modeBit(hover.mode)) ? '' : '（點擊以顯示）'}
        </div>
      )}
    </div>
  );
};

const EvacModePanel = () => {
  const [collapsed, setCollapsed] = useState(false);
  const selectedModes = useMapStore((s) => s.selectedModes);
  const toggleMode = useMapStore((s) => s.toggleMode);
  const { dataUrl } = useResolvedFiles();
  const tablesReady = useEvacTablesReady();
  const mosaicStatus = useBaseRoomStore((s) => (s as unknown as MosaicSliceState).mosaic.connection.status);
  const ready = tablesReady && mosaicStatus === 'ready';

  // 時間軸末端（秒）＝ 最後一格的 t；一支小查詢，只在情境變動時跑
  const { data } = useSql<{ tmax: number }>({
    query: ready
      ? `SELECT CAST(MAX(t) AS DOUBLE) AS tmax FROM ${EVAC_CURVE_ALL_TABLE}`
      : 'SELECT CAST(NULL AS DOUBLE) AS tmax WHERE false',
  });
  const tmaxRaw = data?.arrowTable?.getChild('tmax')?.get(0);
  const tmax = ready && tmaxRaw != null && Number(tmaxRaw) > 0 ? Number(tmaxRaw) : null;

  return (
    <div className={`bg-[#2B2B38]/90 ${PANEL_FRAME} p-3 text-white flex flex-col gap-2 font-mono shadow-xl`}>
      <div className={`flex items-center justify-between ${collapsed ? '' : 'border-b border-slate-700 pb-2'}`}>
        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-400">
          Evac Rate by Mode
          <span
            title={EVAC_INFO_TITLE}
            className="cursor-help text-slate-500 hover:text-slate-300"
          >
            <Info size={12} />
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? '展開 Evac Rate by Mode' : '收合 Evac Rate by Mode'}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          {collapsed ? <Plus size={14} /> : <Minus size={14} />}
        </button>
      </div>
      {!collapsed && (
        <>
          {/* 圖例即過濾：色塊 + 運具名稱（不是 checkbox），關閉時變淡；樣式沿用 ModeSelector 的標籤色 */}
          <div className="flex items-center justify-between" data-testid="evac-legend">
            {ORDERED_MOBILITY_MODES.map((modeName) => {
              const name = modeName.toUpperCase() as ModeName;
              const bit = MOBILITY_MODE_BITS[modeName];
              const on = selectedModes.includes(bit);
              return (
                <button
                  key={name}
                  type="button"
                  data-mode={name}
                  aria-pressed={on}
                  onClick={() => toggleMode(bit)}
                  className={`flex cursor-pointer items-center gap-1.5 text-[13px] transition-opacity ${on ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                  style={{ color: MODE_HEX[name] }}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MODE_HEX[name] }} />
                  {name}
                </button>
              );
            })}
          </div>
          {!dataUrl ? (
            <div className="flex items-center justify-center text-[12px] text-slate-400" style={{ height: CHART_H }}>
              {NO_DATA_HINT}
            </div>
          ) : tmax === null ? (
            <div className="flex items-center justify-center text-[12px] text-slate-400" style={{ height: CHART_H }}>
              載入中…
            </div>
          ) : (
            <Chart key={dataUrl} tmax={tmax} />
          )}
        </>
      )}
    </div>
  );
};

export default EvacModePanel;

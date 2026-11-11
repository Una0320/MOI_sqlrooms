import { useMemo, useRef } from 'react';
import * as arrow from 'apache-arrow';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { AGENT_MODE_TRIP_COLORS, MODE_BIT_LABELS } from '@/constants/map';

const LAYER_ID = 'trips-point';
// zoom > 此值（拉近）才顯示點位；zoom ≤ 此值時由 TripsLayer 尾巴呈現
export const ZOOM_THRESHOLD = 11;
// 高不透明度，獨立於 AGENT_MODE_TRIP_COLORS 的 alpha（見下方賦值處的說明）
const POINTS_ALPHA = 230;
// 經緯度差轉公尺的粗略係數（不需要精準，只是抓量級，算 tooltip 顯示的時速用）
const DEG_TO_METERS = 111000;

// ── 「依單位畫點」規則（Points 層）──────────────────────────────────────────────
//   開車：一台車一個點（n_persons 是車上人數，不展開）。
//   走路：一個人一個點 —— 一個 agent 畫 n_persons 個點，繞著真實位置排成螺旋，避免完全重疊。
//   公車／軌道：同一班車上的乘客聚成一個點（點變大、tooltip 顯示人數）。
//     資料沒有車輛編號，只有「坐車時跟著那台車走」，所以用「同運具 + 同座標（約 1 m 量化）」當成同一班車。
//     抽樣量越小，同車乘客被抽到的越少，聚合效果越不明顯；等車的人停在站上、運具標成要搭的車，會聚成站上一個點。
const WALK_BIT = 1;
const AGGREGATE_BITS = new Set([8, 16]);
const MAX_WALK_DOTS = 60;        // 與資料最大戶人數一致，防止異常值
const GOLDEN_ANGLE = 2.399963;
const COORD_QUANT = 1e5;         // 1e-5 度 ≈ 1 m
// 「多人點」（開車 ≥ 2 人的車、公車/軌道 ≥ 2 人的聚合點）：實心圓點，人數數字寫在圓心裡。
// 它們放在獨立的圖層（畫在走路點/單人點的下面，各自有 meta 供 tooltip），大圓不會擋住底下的點。
// 圓半徑：公車/軌道 = base × (1.5 + 0.35·log2(人數))，上限 3 倍；開車較小（車上 2–5 人）；
// 兩者都有最小半徑，保證放得下 1–3 位數字。
const MULTI_MIN_PERSONS = 2;
// 汽車的人數數字只在 zoom >= 此值才顯示（汽車數量多，低 zoom 全標數字會擠成一片）；公車/軌道聚合點不受限
export const CAR_LABEL_MIN_ZOOM = 14;
const AGG_BASE_MULT = 1.5;
const AGG_GROWTH = 0.35;
const AGG_MAX_MULT = 3;
const AGG_MIN_RADIUS_PX = 8;
const WAIT_FILL_ALPHA = 70; // 等車人群：半透明填色 + 同色外框
const CAR_MULT = 1.4;
const CAR_MIN_RADIUS_PX = 6;
const multiRadius = (mode: number, persons: number, base: number) =>
  mode === 2
    ? Math.max(CAR_MIN_RADIUS_PX, base * CAR_MULT)
    : Math.max(AGG_MIN_RADIUS_PX, Math.min(base * AGG_MAX_MULT, base * (AGG_BASE_MULT + AGG_GROWTH * Math.log2(persons))));
// 依底色亮度挑黑字或白字（黃/綠/淡藍用黑字，紅用白字）
const textColorFor = (mode: number): [number, number, number, number] => {
  const c = AGENT_MODE_TRIP_COLORS[Math.floor(Math.log2(mode))] ?? [255, 255, 255, 200];
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return lum > 150 ? [15, 15, 15, 255] : [255, 255, 255, 255];
};

export type PointMeta = {
  visible: boolean;
  mode: number;
  speedKmh: number;
  segDurationSec: number;
  statusLabel: string;
  /** 這個點代表幾個人：走路 = 1（每人一點）、開車 = 車上人數、公車/軌道聚合點 = 同車已抽樣乘客的人數加總 */
  persons: number;
  /** 聚合點合併了幾個 agent（走路/開車 = 1） */
  agentsMerged: number;
  /** 這個點對應的 agent（trips 資料列）索引；聚合點取第一個併入的 agent。點擊釘選 tooltip 用 */
  agent: number;
  /** 公車/軌道：true = 站上等車的人群（靜止且還沒上過車），false = 已在車上（含停靠中） */
  waiting: boolean;
};

// arrow 的 List 欄位：有 toJSON 就用（Vector），否則當一般 array-like
type ArrowRow = { paths?: unknown; timestamps?: unknown; modes?: unknown; n_persons?: unknown };
const listToArray = (v: unknown): unknown[] => {
  if (!v) return [];
  const toJSON = (v as { toJSON?: () => unknown }).toJSON;
  return typeof toJSON === 'function' ? (toJSON.call(v) as unknown[]) : Array.from(v as ArrayLike<unknown>);
};

type PinnedDatum = { x: number; y: number; text: string; note?: string };
type MultiLabel = { x: number; y: number; text: string; size: number; color: [number, number, number, number] };

type AgentCache = {
  pathFlat: number[];   // 正規化後永遠是 flat: [x0,y0,x1,y1,...]
  timestamps: number[];
  modes: number[];      // 可以是 per-segment 或 per-trip 單一值
  persons: number;      // n_persons（至少 1）
  ridden: Uint8Array;   // 每段：公車/軌道的連續同運具段裡，此段之前是否已經移動過（= 已上車）
};

// 站上等車 vs 車上：資料裡等車的人「停在站上、運具標成要搭的車」，同樣是靜止，但還沒上車；
// 已經在車上的人即使車停靠（也是靜止）之前一定移動過。所以用「同運具連續段裡之前是否移動過」區分。
const computeRidden = (pathFlat: number[], modes: number[], numPoints: number): Uint8Array => {
  const n = Math.max(0, numPoints - 1);
  const out = new Uint8Array(n);
  if (modes.length <= 1) return out;
  let moved = false;
  for (let j = 0; j < n; j++) {
    if (j === 0 || modes[j] !== modes[j - 1]) moved = false;
    out[j] = moved ? 1 : 0;
    if (Math.abs(pathFlat[2 * j + 2] - pathFlat[2 * j]) + Math.abs(pathFlat[2 * j + 3] - pathFlat[2 * j + 1]) > 1e-7) moved = true;
  }
  return out;
};

// timestamps 對每個 agent 是遞增排序，二分搜尋找出 time 落在哪個 segment：
// 回傳 j 使得 timestamps[j] <= time <= timestamps[j+1]。
// 取代原本「每幀都從 0 開始線性掃描」的作法，時間複雜度從 O(numPoints) 降到 O(log numPoints)，
// 且不受時間倒退（拖曳/循環重播）影響，不需要跨幀快取 index。
const findSegmentIndex = (timestamps: number[], time: number): number => {
  let lo = 0;
  let hi = timestamps.length - 2;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timestamps[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export const usePointsLayer = (
  arrowTable: arrow.Table | undefined,
  currentZoom: number,
  pinnedAgent: number | null = null,
) => {
  const { time, selectedModes, visible } = useMapStore(
    useShallow((s) => ({
      time: s.time,
      selectedModes: s.selectedModes,
      visible: s.visibleLayers[LAYER_IDS.TRIPS] ?? true,
    }))
  );

  const memoryRef = useRef<{
    sourceData: arrow.Table;
    agents: AgentCache[];
    positions: Float32Array;
    colors: Uint8Array;
    radii: Float32Array;
    meta: PointMeta[];
    capacity: number;
    aggIndex: Map<number, number>;
    aggPositions: Float32Array;
    aggColors: Uint8Array;
    aggRadii: Float32Array;
    waitPositions: Float32Array;
    waitColors: Uint8Array;
    waitRadii: Float32Array;
  } | null>(null);

  return useMemo(() => {
    if (!arrowTable || !visible || currentZoom <= ZOOM_THRESHOLD) {
      return { layers: [], meta: [] as PointMeta[], aggMeta: [] as PointMeta[], waitMeta: [] as PointMeta[] };
    }

    // arrowTable 換掉時才重建快取，避免每幀 toArray()
    if (memoryRef.current?.sourceData !== arrowTable) {
      const rows = arrowTable.toArray();
      const agents: AgentCache[] = rows.map((row: ArrowRow) => {
        // paths: List<FixedSizeList<2,Float32>> → toJSON() 回傳 [[x0,y0],...] 或已是 flat
        const rawPaths = listToArray(row.paths);
        const isFlat = rawPaths.length > 0 && typeof rawPaths[0] === 'number';
        const pathFlat: number[] = isFlat
          ? rawPaths.map(Number)
          : (rawPaths as ArrayLike<unknown>[]).flatMap((pt) => [Number(pt[0]), Number(pt[1])]);
        const np = Number(row.n_persons);
        const timestamps = listToArray(row.timestamps).map(Number);
        const modes = listToArray(row.modes).map(Number);
        return {
          pathFlat,
          timestamps,
          modes,
          ridden: computeRidden(pathFlat, modes, timestamps.length),
          persons: Number.isFinite(np) && np >= 1 ? np : 1,
        };
      });
      // 最多會有幾個點：每個 agent 最壞情況展開成 n_persons 個走路點
      const capacity = agents.reduce((s, a) => s + Math.min(MAX_WALK_DOTS, a.persons), 0);

      memoryRef.current = {
        sourceData: arrowTable,
        agents,
        positions: new Float32Array(capacity * 3),
        colors: new Uint8Array(capacity * 4),
        radii: new Float32Array(capacity),
        // 物件池：每幀直接改內容，不重新配置，避免數萬 instance 每幀 GC
        meta: Array.from({ length: capacity }, () => ({
          visible: false,
          mode: 0,
          speedKmh: 0,
          segDurationSec: 0,
          statusLabel: '',
          persons: 1,
          agentsMerged: 1,
          agent: -1,
          waiting: false,
        })),
        capacity,
        aggIndex: new Map<number, number>(),
        aggPositions: new Float32Array(rows.length * 3),
        aggColors: new Uint8Array(rows.length * 4),
        aggRadii: new Float32Array(rows.length),
        waitPositions: new Float32Array(rows.length * 3),
        waitColors: new Uint8Array(rows.length * 4),
        waitRadii: new Float32Array(rows.length),
      };
    }

    const { agents, positions, colors, radii, meta, aggIndex, aggPositions, aggColors, aggRadii, waitPositions, waitColors, waitRadii } = memoryRef.current!;
    const dynamicRadius = Math.min(8, Math.max(2, currentZoom - 8));
    // 螢幕 1 px 對應的經緯度（Web Mercator，512px 圖磚）；緯度方向再乘 cos(緯度)，台灣約 25°
    const degPerPx = 360 / (512 * Math.pow(2, currentZoom));
    const latPerPx = degPerPx * 0.906;

    aggIndex.clear();
    let selDot = -1; // 被釘選的 agent 在本幀對應的點（聚合時是它併入的那個點）
    let k = 0; // 本幀實際輸出的點數；instance index = k，meta[k] 與畫面上的第 k 個點對應

    const emit = (agent: number, x: number, y: number, mode: number, radius: number, persons: number, merged: number) => {
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = 0;
      const colorIndex = Math.floor(Math.log2(mode));
      const modeColor = AGENT_MODE_TRIP_COLORS[colorIndex] ?? [255, 255, 255, 200];
      colors[k * 4] = modeColor[0];
      colors[k * 4 + 1] = modeColor[1];
      colors[k * 4 + 2] = modeColor[2];
      // 疊加式混色（additive blend，見下方 parameters）是刻意保留的——密度視覺化需求：
      // 多個代理人重疊在同一位置時要越疊越亮，才能一眼看出哪裡人潮密集。
      // 但 AGENT_MODE_TRIP_COLORS 自帶的 alpha（150）是為 Trips/Heatmap 那種本來就會大量
      // 重疊的軌跡調的；Points 圖層很多時候只有「單一」代理人停在原地，沒有東西可疊加，
      // alpha 150 在深色底圖上單獨看會太暗，容易被誤認成黑點——這裡把單點的基礎 alpha
      // 拉高，讓「只有一個點」時也夠亮，重疊變密集時疊加混色依然會繼續往上疊更亮。
      colors[k * 4 + 3] = POINTS_ALPHA;
      radii[k] = radius;
      const m = meta[k];
      m.visible = true;
      m.mode = mode;
      m.persons = persons;
      m.agentsMerged = merged;
      m.agent = agent;
      m.waiting = false;
      return m;
    };

    for (let i = 0; i < agents.length; i++) {
      const { pathFlat, timestamps, modes, persons } = agents[i];
      const numPoints = timestamps.length;
      if (!pathFlat.length || numPoints < 2) continue;

      const tStart = timestamps[0];
      const tEnd = timestamps[numPoints - 1];
      if (time < tStart || time > tEnd) continue;

      const j = findSegmentIndex(timestamps, time);
      const t1 = timestamps[j];
      const t2 = timestamps[j + 1];

      // modes 可能是 per-segment（長度 = numPoints-1）或 per-trip（長度 1）
      const currentMode = modes.length > 1 ? modes[j] : (modes[0] ?? 1);
      if (!selectedModes.includes(currentMode)) continue;

      const p1x = pathFlat[j * 2];
      const p1y = pathFlat[j * 2 + 1];
      const p2x = pathFlat[(j + 1) * 2];
      const p2y = pathFlat[(j + 1) * 2 + 1];

      // 塞車、等車、長時間停放都是模擬裡真實會發生的狀態，一律照舊顯示、不隱藏——
      // 要看出「哪一段路徑塞住/龜速」改用 tooltip（見下方 meta），不是把點藏起來。
      const ratio = t2 > t1 ? (time - t1) / (t2 - t1) : 0;
      const x = p1x + (p2x - p1x) * ratio;
      const y = p1y + (p2y - p1y) * ratio;

      // tooltip 用：這段路的即時時速，用來判斷是不是塞車/龜速，不影響畫面顯示
      const segDurationSec = t2 - t1;
      const segDistMeters = Math.hypot(p2x - p1x, p2y - p1y) * DEG_TO_METERS;
      const speedKmh = segDurationSec > 0 ? (segDistMeters / segDurationSec) * 3.6 : 0;
      let statusLabel = '';
      if (segDurationSec > 0) {
        if (speedKmh < 1) statusLabel = '幾乎靜止（塞車/等待中）';
        else if (speedKmh < 5) statusLabel = '緩慢移動';
      }

      if (AGGREGATE_BITS.has(currentMode)) {
        // 公車／軌道：同運具 + 同座標 + 同狀態（等車/在車上）→ 同一個點，人數加總
        const stationary = Math.abs(p2x - p1x) + Math.abs(p2y - p1y) < 1e-7;
        const isWaiting = stationary && agents[i].ridden[j] === 0;
        const key = ((Math.round(x * COORD_QUANT) * 4194304 + Math.round(y * COORD_QUANT)) * 2 + (currentMode === 16 ? 1 : 0)) * 2 + (isWaiting ? 1 : 0);
        const existing = aggIndex.get(key);
        if (existing !== undefined) {
          if (i === pinnedAgent) selDot = existing;
          const m = meta[existing];
          m.persons += persons;
          m.agentsMerged += 1;
          continue;
        }
        aggIndex.set(key, k);
        if (i === pinnedAgent) selDot = k;
        const m = emit(i, x, y, currentMode, dynamicRadius, persons, 1);
        m.waiting = isWaiting;
        m.speedKmh = speedKmh;
        m.segDurationSec = segDurationSec;
        m.statusLabel = statusLabel;
        k++;
      } else if (currentMode === WALK_BIT && persons > 1) {
        // 走路：一人一點，螺旋排開（第 0 人在真實位置，其餘繞外圈）
        const n = Math.min(MAX_WALK_DOTS, persons);
        if (i === pinnedAgent) selDot = k;
        for (let p = 0; p < n; p++) {
          const dist = p === 0 ? 0 : dynamicRadius * 1.8 * Math.sqrt(p);
          const ang = p * GOLDEN_ANGLE;
          const m = emit(i, x + Math.cos(ang) * dist * degPerPx, y + Math.sin(ang) * dist * latPerPx, currentMode, dynamicRadius, 1, 1);
          m.speedKmh = speedKmh;
          m.segDurationSec = segDurationSec;
          m.statusLabel = statusLabel;
          k++;
        }
      } else {
        // 開車（一台車一個點）與單人走路
        if (i === pinnedAgent) selDot = k;
        const m = emit(i, x, y, currentMode, dynamicRadius, currentMode === WALK_BIT ? 1 : persons, 1);
        m.speedKmh = speedKmh;
        m.segDurationSec = segDurationSec;
        m.statusLabel = statusLabel;
        k++;
      }
    }
    const numInstances = k;

    // 多人點：從主圖層搬到獨立圖層（主圖層裡該點的半徑設 0，不畫也不被 pick），meta 物件共用同一個參照。
    //   multi：車上 ≥ 2 人的汽車、人數 ≥ 2 的公車/軌道（已在車上）→ 實心圓 + 人數
    //   wait ：站上等車、人數 ≥ 2 → 半透明圓 + 同色外框 + 人數（跟「在車上」一眼分得出來）
    const aggMeta: PointMeta[] = [];
    const waitMeta: PointMeta[] = [];
    const multiLabels: MultiLabel[] = [];
    let na = 0;
    let nw = 0;
    for (let i = 0; i < numInstances; i++) {
      const m = meta[i];
      if (!((m.mode === 2 || AGGREGATE_BITS.has(m.mode)) && m.persons >= MULTI_MIN_PERSONS)) continue;
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const r = multiRadius(m.mode, m.persons, dynamicRadius);
      if (m.waiting) {
        waitPositions[nw * 3] = x;
        waitPositions[nw * 3 + 1] = y;
        waitPositions[nw * 3 + 2] = 0;
        waitColors[nw * 4] = colors[i * 4];
        waitColors[nw * 4 + 1] = colors[i * 4 + 1];
        waitColors[nw * 4 + 2] = colors[i * 4 + 2];
        waitColors[nw * 4 + 3] = WAIT_FILL_ALPHA;
        waitRadii[nw] = r;
        waitMeta.push(m);
        nw++;
      } else {
        aggPositions[na * 3] = x;
        aggPositions[na * 3 + 1] = y;
        aggPositions[na * 3 + 2] = 0;
        aggColors[na * 4] = colors[i * 4];
        aggColors[na * 4 + 1] = colors[i * 4 + 1];
        aggColors[na * 4 + 2] = colors[i * 4 + 2];
        aggColors[na * 4 + 3] = POINTS_ALPHA;
        aggRadii[na] = r;
        aggMeta.push(m);
        na++;
      }
      if (m.mode === 2 && currentZoom < CAR_LABEL_MIN_ZOOM) continue; // 汽車數字只在拉近時顯示
      multiLabels.push({
        x,
        y,
        text: String(m.persons),
        size: m.persons >= 100 ? 8 : m.persons >= 10 ? 9 : 10,
        color: m.waiting ? [255, 255, 255, 255] : textColorFor(m.mode),
      });
    }

    // 被點擊釘選的 agent：tooltip 卡片 + 一圈白色外框，每幀跟著該 agent 的位置
    // （agent 不在畫面上——還沒出發、已抵達、或運具被取消勾選——就先不畫，拖回時間軸會再出現）
    const pinned: PinnedDatum[] = [];
    if (selDot >= 0 && pinnedAgent !== null) {
      const m = meta[selDot];
      const a = agents[pinnedAgent];
      const lines = [`agent #${pinnedAgent}`, `運具: ${MODE_BIT_LABELS[m.mode] ?? '未知'}`];
      if (m.mode === WALK_BIT) {
        // 走路：一點 = 1 人；整戶人數另列
        lines.push('本點: 1 人');
        if (a.persons > 1) lines.push(`同戶共 ${a.persons} 人，畫成 ${Math.min(MAX_WALK_DOTS, a.persons)} 個點`);
      } else {
        lines.push(`代表人數: ${a.persons} 人`);
      }
      if (m.waiting) lines.push(`抽樣等車: ${m.persons} 人（${m.agentsMerged} 個 agent）`);
      else if (m.agentsMerged > 1) lines.push(`同車已抽樣乘客: ${m.persons} 人（${m.agentsMerged} 個 agent）`);
      lines.push(`目前路段時速: ${m.segDurationSec > 0 ? `${m.speedKmh.toFixed(1)} km/h` : '—'}${m.statusLabel ? `（${m.statusLabel}）` : ''}`);
      pinned.push({
        x: positions[selDot * 3],
        y: positions[selDot * 3 + 1],
        text: lines.join('\n'),
        // 單一 TextLayer 沒辦法讓某一行換色／縮小，所以註記是卡片正下方另一個小框
        note: m.waiting ? '僅含抽樣 agent，實際候車請對照 Stop Counts 圖層' : undefined,
      });
    }

    return {
      layers: [
        // 先畫等車人群（最底），再畫車上多人點（大圓在下），再畫單點，最後是數字
        new ScatterplotLayer({
          id: `${LAYER_ID}-wait`,
          data: {
            length: nw,
            attributes: {
              getPosition: { value: waitPositions.slice(0, nw * 3), size: 3 },
              getFillColor: { value: waitColors.slice(0, nw * 4), size: 4 },
              getLineColor: { value: waitColors.slice(0, nw * 4).map((v, idx) => (idx % 4 === 3 ? 235 : v)), size: 4 },
              getRadius: { value: waitRadii.slice(0, nw), size: 1 },
            },
          },
          radiusUnits: 'pixels',
          stroked: true,
          filled: true,
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
          pickable: true,
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer({
          id: `${LAYER_ID}-multi`,
          data: {
            length: na,
            attributes: {
              getPosition: { value: aggPositions.slice(0, na * 3), size: 3 },
              getFillColor: { value: aggColors.slice(0, na * 4), size: 4 },
              getRadius: { value: aggRadii.slice(0, na), size: 1 },
            },
          },
          radiusUnits: 'pixels',
          pickable: true,
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer({
          id: LAYER_ID,
          data: {
            length: numInstances,
            attributes: {
              getPosition: { value: positions.slice(0, numInstances * 3), size: 3 },
              getFillColor: { value: colors.slice(0, numInstances * 4), size: 4 },
              // 半徑逐點獨立：不可見的 agent、以及已搬到多人點圖層的點，半徑是 0，不畫也不會被 hover 命中
              //（之前只清透明度、沒清半徑，才會出現「看不到又能被 pick 到」的幽靈點）。
              getRadius: { value: radii.slice(0, numInstances), size: 1 },
            },
          },
          radiusUnits: 'pixels',
          pickable: true,
          // 疊加式混色（additive）：主管要的密度視覺化效果，多個代理人疊在同一點時會越疊越亮。
          // 單點太暗的問題改用上面調高的 alpha 解決，不動這裡的混色模式。
          parameters: {
            depthTest: false,
            blend: true,
            blendColorSrcFactor: 'src-alpha' as const,
            blendColorDstFactor: 'one' as const,
            blendColorOperation: 'add' as const,
          },
        }),
        new TextLayer({
          id: `${LAYER_ID}-multi-text`,
          data: multiLabels,
          getPosition: (d: MultiLabel) => [d.x, d.y, 0],
          getText: (d: MultiLabel) => d.text,
          getSize: (d: MultiLabel) => d.size,
          getColor: (d: MultiLabel) => d.color,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontSettings: { sdf: true },
          fontWeight: 700,
          pickable: false,
          parameters: { depthTest: false },
        }),
        // 釘選：白色外框 + 卡片（卡片在最上層）
        new ScatterplotLayer<PinnedDatum>({
          id: `${LAYER_ID}-pinned-ring`,
          data: pinned,
          getPosition: (d: PinnedDatum) => [d.x, d.y, 0],
          getRadius: dynamicRadius + 6,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          pickable: false,
          parameters: { depthCompare: 'always' as const },
        }),
        new TextLayer<PinnedDatum>({
          id: `${LAYER_ID}-pinned-card`,
          data: pinned,
          getPosition: (d: PinnedDatum) => [d.x, d.y, 0],
          getText: (d: PinnedDatum) => d.text,
          getSize: 12,
          getColor: [255, 255, 255, 255],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'bottom',
          // 有註記時主卡片整個上移（註記框佔 -16 的位置），兩框之間留 2px
          getPixelOffset: (d: PinnedDatum) => (d.note ? [16, -38] : [16, -16]),
          updateTriggers: { getPixelOffset: [pinnedAgent, time] },
          background: true,
          getBackgroundColor: [30, 30, 40, 235],
          getBorderColor: [255, 255, 255, 120],
          getBorderWidth: 1,
          backgroundPadding: [8, 5],
          backgroundBorderRadius: 4,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          characterSet: 'auto',
          pickable: false,
          parameters: { depthCompare: 'always' as const },
        }),
        new TextLayer<PinnedDatum>({
          id: `${LAYER_ID}-pinned-note`,
          data: pinned.filter((d) => d.note),
          getPosition: (d: PinnedDatum) => [d.x, d.y, 0],
          getText: (d: PinnedDatum) => d.note ?? '',
          getSize: 10,
          getColor: [170, 175, 190, 255],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'bottom',
          getPixelOffset: [16, -16],
          background: true,
          getBackgroundColor: [30, 30, 40, 235],
          getBorderColor: [255, 255, 255, 70],
          getBorderWidth: 1,
          backgroundPadding: [8, 5],
          backgroundBorderRadius: 4,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          characterSet: 'auto',
          pickable: false,
          parameters: { depthCompare: 'always' as const },
        }),
      ],
      meta,
      aggMeta,
      waitMeta,
    };
  }, [arrowTable, visible, currentZoom, time, selectedModes, pinnedAgent]);
};

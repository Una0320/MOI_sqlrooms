import { LAYER_IDS } from '../constants/layers';
import { PANEL_FRAME } from '../constants/layout';
import { ROAD_LEVEL_HEX, ROAD_LEVEL_LABELS, ROAD_LEVELS } from '../constants/roadService';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { useMapStore } from '../zustand/useMapStore';

// Road Service 圖例寬度：固定在 220–240px 之間，說明文字寬度不夠就換行，不撐寬。
// Timeline 會依這個寬度被往右推（見 MainView.tsx）。
export const ROAD_SERVICE_LEGEND_WIDTH_PX = 232;

// 切換 Road Service 圖層時才顯示。色條 A–F 六段上下緊貼成一條連續長條（只有最上、最下的外側角是圓角），
// 每一段的高度跟著同一列文字的高度走（說明文字換成兩行，那一段就變高），所以色塊與文字永遠對齊。
// 色塊顏色取自 ROAD_LEVEL_HEX——跟地圖路段共用同一組常數。右邊是 README 圖例的速率比範圍。
export const RoadServiceLegend = () => {
  const visible = useMapStore((s) => s.visibleLayers[LAYER_IDS.ROAD_SERVICE] ?? false);
  const { roadServiceUrl } = useResolvedFiles();

  if (!visible || !roadServiceUrl) return null;

  return (
    <div
      className={`self-start bg-[#2B2B38]/90 ${PANEL_FRAME} p-3 text-white font-mono text-xs shadow-xl`}
      style={{ width: ROAD_SERVICE_LEGEND_WIDTH_PX }}
    >
      <div className="font-bold uppercase tracking-wider text-slate-400 leading-tight">Road Service</div>
      <div className="mb-2 text-[11px] leading-tight text-slate-500">道路服務水準（速率比，逐小時）</div>
      {/* 同一個 grid 的三欄共用同一列高度：色條那欄沒有 row gap，所以六段緊貼；列距靠文字欄的 padding */}
      <div className="grid grid-cols-[10px_auto_1fr] gap-x-2">
        {ROAD_LEVELS.map((lv, i) => (
          <div key={lv} className="contents">
            <span
              className={i === 0 ? 'rounded-t-md' : i === ROAD_LEVELS.length - 1 ? 'rounded-b-md' : undefined}
              style={{ background: ROAD_LEVEL_HEX[lv] }}
            />
            <span className="py-1 font-bold">{lv}</span>
            <span className="py-1 leading-snug text-slate-300">{ROAD_LEVEL_LABELS[lv]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

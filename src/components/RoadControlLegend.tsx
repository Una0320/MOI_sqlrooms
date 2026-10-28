import { LAYER_IDS } from '../constants/layers';
import { PANEL_FRAME } from '../constants/layout';
import { ROAD_CONTROL_HEX, ROAD_CONTROL_LABELS, ROAD_CONTROL_MEASURES } from '../constants/roadService';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { useMapStore } from '../zustand/useMapStore';

// 切換 Road Control 圖層時才顯示（跟 RoadServiceLegend 同樣式）。色塊取自 ROAD_CONTROL_HEX，與地圖共用同一份。
export const RoadControlLegend = () => {
  const visible = useMapStore((s) => s.visibleLayers[LAYER_IDS.ROAD_CONTROL] ?? false);
  const { roadControlUrl } = useResolvedFiles();

  if (!visible || !roadControlUrl) return null;

  return (
    <div className={`self-start bg-[#2B2B38]/90 ${PANEL_FRAME} p-3 text-white font-mono text-xs shadow-xl`}>
      <div className="font-bold uppercase tracking-wider text-slate-400 leading-tight">Road Control</div>
      <div className="mb-2 text-[11px] leading-tight text-slate-500">道路管制</div>
      <div className="flex flex-col gap-1">
        {ROAD_CONTROL_MEASURES.map((m) => (
          <div key={m} className="flex items-center gap-2">
            <span className="h-1 w-4 rounded-full" style={{ background: ROAD_CONTROL_HEX[m] }} />
            <span className="text-slate-300">{ROAD_CONTROL_LABELS[m]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

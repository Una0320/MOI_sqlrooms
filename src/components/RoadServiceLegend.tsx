import { LAYER_IDS } from '../constants/layers';
import {
  LOS_HEX,
  LOS_LABELS,
  LOS_LEVELS,
  ROAD_WIDTH_SAMPLES,
  logVcOf,
  roadWidthPx,
} from '../constants/roadService';
import { useRoadServiceSource } from '../hooks/useRoadServiceLayer';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { useMapStore } from '../zustand/useMapStore';

// 切換 Road Service 圖層時才顯示。左欄：LOS 色階；右欄：線寬對照（粗細 = 壅塞程度）。
export const RoadServiceLegend = () => {
  const visible = useMapStore((s) => s.visibleLayers[LAYER_IDS.ROAD_SERVICE] ?? false);
  const { roadServiceUrl } = useResolvedFiles();
  const source = useRoadServiceSource();

  if (!visible || !roadServiceUrl) return null;

  return (
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-3 rounded-lg text-white font-mono text-xs shadow-xl backdrop-blur-sm">
      <div className="font-bold uppercase tracking-wider text-slate-400 mb-2">
        Road Service · 道路服務水準
      </div>
      <div className="flex gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500">LOS（V/C）</span>
          {LOS_LEVELS.map((los) => {
            return (
              <div key={los} className="flex items-center gap-2">
                <span className="w-6 h-1.5 rounded-full" style={{ background: LOS_HEX[los] }} />
                <span className="w-3 font-bold">{los}</span>
                <span className="text-slate-400">{LOS_LABELS[los]}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500">線寬 ∝ √log(1+V/C)</span>
          {ROAD_WIDTH_SAMPLES.map((vc) => (
            <div key={vc} className="flex items-center gap-2">
              <span
                className="w-6 rounded-full bg-slate-300"
                style={{ height: `${roadWidthPx(logVcOf(vc))}px` }}
              />
              <span className="text-slate-400">V/C {vc.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 text-[10px] text-slate-500">
        尖峰小時靜態值{source ? ` · 來源模擬：${source}` : ''}
      </div>
    </div>
  );
};

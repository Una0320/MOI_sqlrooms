import { LAYER_IDS } from '../constants/layers';
import { SHELTER_STATUS_COLORS, SHELTER_STATUS_LEGEND } from '../constants/map';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { useMapStore } from '../zustand/useMapStore';

// 切換 Shelter Capacity 圖層時才顯示（跟 RoadServiceLegend 同樣式）。色塊取自 SHELTER_STATUS_COLORS，
// 跟地圖上的圓圈共用同一份顏色表。
export const ShelterCapacityLegend = () => {
  const visible = useMapStore((s) => s.visibleLayers[LAYER_IDS.SHELTER_CAPACITY] ?? false);
  const { shelterCapacityUrl } = useResolvedFiles();

  if (!visible || !shelterCapacityUrl) return null;

  return (
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-3 rounded-lg text-white font-mono text-xs shadow-xl backdrop-blur-sm">
      <div className="font-bold uppercase tracking-wider text-slate-400 mb-2">
        Shelter Capacity · 避難所飽和率
      </div>
      <div className="flex flex-col gap-1">
        {SHELTER_STATUS_LEGEND.map(({ status, label, range }) => {
          const [r, g, b, a] = SHELTER_STATUS_COLORS[status];
          return (
            <div key={status} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: `rgba(${r}, ${g}, ${b}, ${a / 255})` }} />
              <span className="w-16">{label}</span>
              <span className="text-slate-400">{range}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-slate-500">圓圈大小與圈內數字 = 收容人數 ÷ 容量</div>
    </div>
  );
};

import { useMapStore } from '@/zustand/useMapStore';
import { AGENT_MODE_TRIP_COLORS, MOBILITY_MODE_BITS, ORDERED_MOBILITY_MODES } from '../constants/map';


export const ModeSelector = () => {
  const selectedModes = useMapStore((state) => state.selectedModes); // 直接訂閱 selectedModes 狀態，確保即時更新
  const toggleMode = useMapStore((state) => state.toggleMode); // 直接訂閱 toggleMode 函數

  return (
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-4 rounded-lg text-white flex flex-col gap-3 font-mono shadow-xl backdrop-blur-sm">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-2">
        Mobility Modes
      </span>
      {ORDERED_MOBILITY_MODES.map((modeName) => {
        const bitValue = MOBILITY_MODE_BITS[modeName];
        const isChecked = selectedModes.includes(bitValue);
        // 跟地圖上軌跡/點位同一份顏色表（AGENT_MODE_TRIP_COLORS），用 log2(bit) 對照，
        // 而不是這裡的顯示順序 index——顏色表是照實際資料的 mode bit 排的
        const colorIndex = Math.floor(Math.log2(bitValue));
        const [r, g, b] = AGENT_MODE_TRIP_COLORS[colorIndex] ?? [255, 255, 255];

        return (
          <label key={modeName} className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleMode(bitValue)}
              className="accent-cyan-500 w-4 h-4 cursor-pointer"
            />
            <span
              className={`text-sm uppercase transition-opacity ${isChecked ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`}
              style={{ color: `rgb(${r}, ${g}, ${b})` }}
            >
              {modeName}
            </span>
          </label>
        );
      })}
    </div>
  );
};
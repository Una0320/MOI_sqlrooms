import { useMapStore } from '@/zustand/useMapStore';
import { ORDERED_MOBILITY_MODES } from '../constants/map';


export const ModeSelector = () => {
  const selectedModes = useMapStore((state) => state.selectedModes); // 直接訂閱 selectedModes 狀態，確保即時更新
  const toggleMode = useMapStore((state) => state.toggleMode); // 直接訂閱 toggleMode 函數

  return (
    <div className="absolute top-5 right-5 z-10 bg-[#2B2B38]/90 border border-slate-700 p-4 rounded-lg text-white flex flex-col gap-3 font-mono shadow-xl backdrop-blur-sm">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-2">
        Mobility Modes
      </span>
      {ORDERED_MOBILITY_MODES.map((modeName, index) => {
        const bitValue = 1 << index; 
        const isChecked = selectedModes.includes(bitValue);
        
        return (
          <label key={modeName} className="flex items-center gap-3 cursor-pointer group">
            <input 
              type="checkbox" 
              checked={isChecked}
              onChange={() => toggleMode(bitValue)}
              className="accent-cyan-500 w-4 h-4 cursor-pointer"
            />
            <span className={`text-sm uppercase transition-colors ${isChecked ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}>
              {modeName}
            </span>
          </label>
        );
      })}
    </div>
  );
};
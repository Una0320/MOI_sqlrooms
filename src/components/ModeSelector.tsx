import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useMapStore } from '@/zustand/useMapStore';
import { PANEL_FRAME } from '../constants/layout';
import { AGENT_MODE_TRIP_COLORS, MOBILITY_MODE_BITS, ORDERED_MOBILITY_MODES } from '../constants/map';


export const ModeSelector = () => {
  const [collapsed, setCollapsed] = useState(false);
  const selectedModes = useMapStore((state) => state.selectedModes); // 直接訂閱 selectedModes 狀態，確保即時更新
  const toggleMode = useMapStore((state) => state.toggleMode); // 直接訂閱 toggleMode 函數

  return (
    <div className={`bg-[#2B2B38]/90 ${PANEL_FRAME} p-3 text-white flex flex-col gap-2 font-mono shadow-xl`}>
      <div className={`flex items-center justify-between ${collapsed ? '' : 'border-b border-slate-700 pb-2'}`}>
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Mobility Modes</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? '展開 Mobility Modes' : '收合 Mobility Modes'}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          {collapsed ? <Plus size={14} /> : <Minus size={14} />}
        </button>
      </div>
      {!collapsed && ORDERED_MOBILITY_MODES.map((modeName) => {
        const bitValue = MOBILITY_MODE_BITS[modeName];
        const isChecked = selectedModes.includes(bitValue);
        // 跟地圖上軌跡/點位同一份顏色表（AGENT_MODE_TRIP_COLORS），用 log2(bit) 對照，
        // 而不是這裡的顯示順序 index——顏色表是照實際資料的 mode bit 排的
        const colorIndex = Math.floor(Math.log2(bitValue));
        const [r, g, b] = AGENT_MODE_TRIP_COLORS[colorIndex] ?? [255, 255, 255];

        return (
          <label key={modeName} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleMode(bitValue)}
              className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span
              className={`text-[13px] uppercase transition-opacity ${isChecked ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`}
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
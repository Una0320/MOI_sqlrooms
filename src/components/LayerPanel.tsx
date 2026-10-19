import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useShallow } from '@sqlrooms/room-shell';

import { NO_DATA_HINT } from '../constants/data';
import { LAYER_CONFIG, type LayerId } from '../constants/layers';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { useMapStore } from '../zustand/useMapStore';

export const LayerPanel = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { visibleLayers, toggleLayer } = useMapStore(
    useShallow((s) => ({
      visibleLayers: s.visibleLayers,
      toggleLayer: s.toggleLayer,
    })),
  );
  const files = useResolvedFiles();

  return (
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-3 rounded-lg text-white flex flex-col gap-2 font-mono shadow-xl backdrop-blur-sm">
      <div className={`flex items-center justify-between ${collapsed ? '' : 'border-b border-slate-700 pb-2'}`}>
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Layers</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? '展開 Layers' : '收合 Layers'}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          {collapsed ? <Plus size={14} /> : <Minus size={14} />}
        </button>
      </div>
      {!collapsed && LAYER_CONFIG.map((layer) => {
        // 圖層可用與否只看 manifest 裡對應的 url 是不是 null：沒資料就 disabled 並提示（不隱藏）
        const noData = files[layer.requires] === null;
        const isChecked = !noData && (visibleLayers[layer.id] ?? false);
        return (
          <label
            key={layer.id}
            className={`flex items-start gap-2 group ${noData ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              disabled={noData}
              onChange={() => toggleLayer(layer.id as LayerId)}
              className="accent-cyan-500 w-3.5 h-3.5 mt-[3px] shrink-0 cursor-pointer disabled:cursor-not-allowed"
            />
            {/* whitespace-nowrap：標題不換行也不截斷；沒資料的提示另起一行（獨立小字），不跟標題擠在同一行 */}
            <span className="flex flex-col leading-tight">
              <span
                className={`text-[13px] whitespace-nowrap transition-colors ${
                  isChecked ? 'text-white' : 'text-slate-400 group-hover:text-slate-300'
                }`}
              >
                {layer.title}
              </span>
              {noData && <span className="text-[11px] text-slate-500">{NO_DATA_HINT}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
};

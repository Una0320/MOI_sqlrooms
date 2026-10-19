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
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-4 rounded-lg text-white flex flex-col gap-3 font-mono shadow-xl backdrop-blur-sm">
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
        const [r, g, b] = layer.color ?? [];
        return (
          <label key={layer.id} className={`flex items-center gap-3 group ${noData ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={isChecked}
              disabled={noData}
              onChange={() => toggleLayer(layer.id as LayerId)}
              className="accent-cyan-500 w-4 h-4 cursor-pointer"
            />
            <span
              className={`text-sm transition-opacity ${
                layer.color
                  ? isChecked ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'
                  : `transition-colors ${isChecked ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`
              }`}
              style={layer.color ? { color: `rgb(${r}, ${g}, ${b})` } : undefined}
            >
              {layer.title}
            </span>
            {noData && <span className="text-[11px] text-slate-500">{NO_DATA_HINT}</span>}
          </label>
        );
      })}
    </div>
  );
};

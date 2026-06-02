import { useShallow } from '@sqlrooms/room-shell';

import { LAYER_CONFIG, type LayerId } from '../constants/layers';
import { useMapStore } from '../zustand/useMapStore';

export const LayerPanel = () => {
  const { visibleLayers, toggleLayer } = useMapStore(
    useShallow((s) => ({
      visibleLayers: s.visibleLayers,
      toggleLayer: s.toggleLayer,
    })),
  );

  return (
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-4 rounded-lg text-white flex flex-col gap-3 font-mono shadow-xl backdrop-blur-sm">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-2">
        Layers
      </span>
      {LAYER_CONFIG.map((layer) => {
        const isChecked = visibleLayers[layer.id] ?? false;
        return (
          <label key={layer.id} className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleLayer(layer.id as LayerId)}
              className="accent-cyan-500 w-4 h-4 cursor-pointer"
            />
            <span
              className={`text-sm transition-colors ${
                isChecked ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'
              }`}
            >
              {layer.title}
            </span>
          </label>
        );
      })}
    </div>
  );
};

import { useShallow } from '@sqlrooms/room-shell';

import { LAYER_CONFIG, type LayerId } from '../constants/layers';
import { useMapStore } from '../zustand/useMapStore';

export const LayerPanel = () => {
  const { visibleLayers, toggleLayer, scenarioType } = useMapStore(
    useShallow((s) => ({
      visibleLayers: s.visibleLayers,
      toggleLayer: s.toggleLayer,
      scenarioType: s.scenarioType,
    })),
  );

  // 情境限定的圖層（Stations/Stop Counts、Shelters/Shelter Capacity）只在對應情境下顯示，
  // 不是留著關掉——切到不相關的情境時，這個選項直接從面板消失。
  const visibleConfig = LAYER_CONFIG.filter((l) => !l.scenario || l.scenario === scenarioType);

  return (
    <div className="bg-[#2B2B38]/90 border border-slate-700 p-4 rounded-lg text-white flex flex-col gap-3 font-mono shadow-xl backdrop-blur-sm">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-700 pb-2">
        Layers
      </span>
      {visibleConfig.map((layer) => {
        const isChecked = visibleLayers[layer.id] ?? false;
        const [r, g, b] = layer.color ?? [];
        return (
          <label key={layer.id} className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={isChecked}
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
          </label>
        );
      })}
    </div>
  );
};

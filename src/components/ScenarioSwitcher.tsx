import { useShallow } from '@sqlrooms/room-shell';

import { useMapStore } from '@/zustand/useMapStore';
import { PANEL_FRAME } from '@/constants/layout';
import {
  NOT_PROVIDED_HINT,
  SCENARIO_LABELS,
  SCENARIO_ORDER,
  isScenarioAvailable,
} from '@/constants/data';

// 情境分頁：大規模撤離／混合避難／優先疏散。沒有任何資料的分頁 disabled，提示「資料尚未提供」。
// 抽樣量選擇器在 Timeline 上（timebar/SampleSizeSelector.tsx），不在這裡。
export const ScenarioSwitcher = () => {
  const { scenarioType, setScenarioType, networkControl } = useMapStore(
    useShallow((s) => ({
      scenarioType: s.scenarioType,
      setScenarioType: s.setScenarioType,
      networkControl: s.networkControl,
    }))
  );
  const control = networkControl ? 'network_control' : 'none';

  return (
    <div className={`flex items-center bg-[#2B2B38]/90 ${PANEL_FRAME} p-1 gap-1 shadow-xl font-mono`}>
      {SCENARIO_ORDER.map((type) => {
        const disabled = !isScenarioAvailable(type, control);
        const active = scenarioType === type;
        return (
          <button
            key={type}
            disabled={disabled}
            title={disabled ? NOT_PROVIDED_HINT : undefined}
            onClick={() => setScenarioType(type)}
            className={`h-8 px-4 text-sm rounded-md transition-all ${
              active
                ? 'bg-cyan-500 text-slate-900 shadow-sm'
                : disabled
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {SCENARIO_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
};

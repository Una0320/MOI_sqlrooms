import { useShallow } from '@sqlrooms/room-shell';

import { useMapStore } from '@/zustand/useMapStore';
import {
  NOT_PROVIDED_HINT,
  NO_DATA_HINT,
  RATIOS,
  SCENARIO_LABELS,
  SCENARIO_ORDER,
  isAvailable,
  isScenarioAvailable,
} from '@/constants/data';

const buttonClass = (active: boolean, disabled: boolean) =>
  `h-8 px-4 text-sm rounded-md transition-all ${
    active
      ? 'bg-cyan-500 text-slate-900 shadow-sm'
      : disabled
        ? 'text-slate-600 cursor-not-allowed'
        : 'text-slate-400 hover:text-white hover:bg-slate-700'
  }`;

// 上排：情境分頁（沒有任何資料的分頁 disabled，提示「資料尚未提供」）；
// 下排：ratio 10/20/40（該 情境×管制 組合沒資料的 disabled，提示「此組合無資料」）。
export const ScenarioSwitcher = () => {
  const { scenarioType, setScenarioType, ratio, setRatio, networkControl } = useMapStore(
    useShallow((s) => ({
      scenarioType: s.scenarioType,
      setScenarioType: s.setScenarioType,
      ratio: s.ratio,
      setRatio: s.setRatio,
      networkControl: s.networkControl,
    }))
  );
  const control = networkControl ? 'network_control' : 'none';

  return (
    <div className="flex flex-col items-center gap-2 font-mono">
      <div className="flex items-center bg-[#2B2B38]/90 border border-slate-700 rounded-lg p-1 gap-1 shadow-xl backdrop-blur-sm">
        {SCENARIO_ORDER.map((type) => {
          const disabled = !isScenarioAvailable(type, control);
          return (
            <button
              key={type}
              disabled={disabled}
              title={disabled ? NOT_PROVIDED_HINT : undefined}
              onClick={() => setScenarioType(type)}
              className={buttonClass(scenarioType === type, disabled)}
            >
              {SCENARIO_LABELS[type]}
            </button>
          );
        })}
      </div>
      <div className="flex items-center bg-[#2B2B38]/90 border border-slate-700 rounded-lg p-1 gap-1 shadow-xl backdrop-blur-sm">
        <span className="text-[11px] font-bold text-slate-500 px-2 uppercase tracking-widest">Ratio</span>
        {RATIOS.map((r) => {
          const disabled = !isAvailable({ scenario: scenarioType, control, ratio: r });
          return (
            <button
              key={r}
              disabled={disabled}
              title={disabled ? NO_DATA_HINT : undefined}
              onClick={() => setRatio(r)}
              className={`${buttonClass(ratio === r, disabled)} h-7 px-3 text-xs`}
            >
              {r}
            </button>
          );
        })}
      </div>
    </div>
  );
};

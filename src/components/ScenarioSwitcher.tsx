import { useShallow } from '@sqlrooms/room-shell';

import { useMapStore } from '@/zustand/useMapStore';
import { SCENARIO_CONFIG, type ScenarioType } from '@/constants/data';

const SCENARIO_ORDER: ScenarioType[] = ['shelter_in_place', 'mass_evacuation'];

export const ScenarioSwitcher = () => {
  const { scenarioType, setScenarioType } = useMapStore(
    useShallow((s) => ({
      scenarioType: s.scenarioType,
      setScenarioType: s.setScenarioType,
    }))
  );

  return (
    <div className="flex items-center bg-[#2B2B38]/90 border border-slate-700 rounded-lg p-1 gap-1 shadow-xl backdrop-blur-sm font-mono">
      {SCENARIO_ORDER.map((type) => {
        const isActive = scenarioType === type;
        return (
          <button
            key={type}
            onClick={() => setScenarioType(type)}
            className={`h-8 px-4 text-sm rounded-md transition-all ${
              isActive
                ? 'bg-cyan-500 text-slate-900 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {SCENARIO_CONFIG[type].label}
          </button>
        );
      })}
    </div>
  );
};

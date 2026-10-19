import { useShallow } from '@sqlrooms/room-shell';

import { NO_DATA_HINT, isAvailable } from '../constants/data';
import { useMapStore } from '../zustand/useMapStore';

// 路網管制（Network Control）開關：開啟時所有情境改用管制版模擬結果。
// 狀態存在 store、切情境 / 切 ratio 都不會被重置。目前交付批次沒有任何管制版檔案，
// 所以「目前組合沒有管制版資料」時開關 disabled；已經開著的話保持可點，才能關回去。
export const NetworkControlToggle = () => {
  const { networkControl, setNetworkControl, scenarioType, ratio } = useMapStore(
    useShallow((s) => ({
      networkControl: s.networkControl,
      setNetworkControl: s.setNetworkControl,
      scenarioType: s.scenarioType,
      ratio: s.ratio,
    })),
  );
  const hasControlData = isAvailable({ scenario: scenarioType, control: 'network_control', ratio });
  const disabled = !networkControl && !hasControlData;

  return (
    <label
      title={disabled ? NO_DATA_HINT : undefined}
      className={`bg-[#2B2B38]/90 border border-slate-700 px-4 py-3 rounded-lg text-white flex items-center gap-3 font-mono shadow-xl backdrop-blur-sm ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={networkControl}
        disabled={disabled}
        onChange={(e) => setNetworkControl(e.target.checked)}
        className="accent-cyan-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
      />
      <span className="text-sm">Network Control · 路網管制</span>
      {disabled && <span className="text-[11px] text-slate-500">{NO_DATA_HINT}</span>}
    </label>
  );
};

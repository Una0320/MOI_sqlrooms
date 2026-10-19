import { useShallow } from '@sqlrooms/room-shell';

import { Switch } from '@/components/ui/switch';
import { NO_DATA_HINT, isAvailable } from '../constants/data';
import { PANEL_FRAME } from '../constants/layout';
import { useMapStore } from '../zustand/useMapStore';

// 路網管制（Network Control）開關：開啟時所有情境改用管制版模擬結果。
// 狀態存在 store、切情境 / 切 ratio 都不會被重置。目前交付批次沒有任何管制版檔案，
// 所以「目前組合沒有管制版資料」時開關 disabled（整列明顯變淡）；已經開著的話保持可點，才能關回去。
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
      className={`bg-[#2B2B38]/90 ${PANEL_FRAME} px-3 py-2 text-white flex items-center justify-between gap-2 font-mono shadow-xl ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      }`}
    >
      <span className="flex flex-col leading-tight">
        <span className="text-[13px] whitespace-nowrap">Network Control · 路網管制</span>
        {disabled && <span className="text-[11px] text-slate-400">{NO_DATA_HINT}</span>}
      </span>
      <Switch checked={networkControl} disabled={disabled} onCheckedChange={setNetworkControl} aria-label="Network Control 路網管制" />
    </label>
  );
};

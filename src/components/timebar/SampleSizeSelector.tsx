import { useShallow } from "@sqlrooms/room-shell";

import { NO_DATA_HINT, SAMPLE_SIZES, isAvailable } from "@/constants/data";
import { useMapStore } from "@/zustand/useMapStore";

// Timeline 上的抽樣量選擇器（軌跡 / OD 弧線的 agent 數）：左邊標籤，右邊 1 / 4 / 5 / 7 萬並排的分段按鈕，選中的那顆高亮。
// 沒資料的選項 disabled，提示「此組合無資料」。切換時 store 的 setSampleSize 會把時間軸重置。
export const SampleSizeSelector = () => {
  const { scenarioType, sampleSize, setSampleSize, networkControl } = useMapStore(
    useShallow((s) => ({
      scenarioType: s.scenarioType,
      sampleSize: s.sampleSize,
      setSampleSize: s.setSampleSize,
      networkControl: s.networkControl,
    })),
  );
  const control = networkControl ? "network_control" : "none";

  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-slate-700 bg-[#1e1e24] p-0.5">
      <span className="px-2 text-[11px] font-bold tracking-widest text-slate-500 whitespace-nowrap">抽樣</span>
      {SAMPLE_SIZES.map((n) => {
        const disabled = !isAvailable({ scenario: scenarioType, control, sampleSize: n });
        const active = n === sampleSize;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            title={disabled ? NO_DATA_HINT : `${n.toLocaleString()} 個 agent`}
            onClick={() => setSampleSize(n)}
            className={`h-6 min-w-8 rounded-md px-2 font-mono text-xs transition-colors ${
              active
                ? "bg-cyan-500 text-slate-900 shadow-sm"
                : disabled
                  ? "cursor-not-allowed text-slate-600"
                  : "cursor-pointer text-slate-400 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {n / 10000}萬
          </button>
        );
      })}
    </div>
  );
};

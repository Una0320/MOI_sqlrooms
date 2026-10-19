import { useShallow } from "@sqlrooms/room-shell";

import { NO_DATA_HINT, RATIOS, RATIO_LABELS, isAvailable } from "@/constants/data";
import { useMapStore } from "@/zustand/useMapStore";

// Timeline 上的 ratio 選擇器：左邊標籤（文字來自 manifest 的 RATIO_LABELS，每個情境各自指定），
// 右邊 10 / 20 / 40 三顆並排的分段按鈕（segmented control），選中的那顆高亮。
// 刻意不加任何說明 ratio / 標籤意義的 tooltip（意義待資料端確認）；唯一的提示是沒資料的選項 disabled 時的「此組合無資料」。
// 切換時 store 的 setRatio 會把時間軸重置（維持既有行為）。
export const RatioSelector = () => {
  const { scenarioType, ratio, setRatio, networkControl } = useMapStore(
    useShallow((s) => ({
      scenarioType: s.scenarioType,
      ratio: s.ratio,
      setRatio: s.setRatio,
      networkControl: s.networkControl,
    })),
  );
  const control = networkControl ? "network_control" : "none";
  const label = RATIO_LABELS[scenarioType];

  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-slate-700 bg-[#1e1e24] p-0.5">
      {label && (
        <span className="px-2 text-[11px] font-bold tracking-widest text-slate-500 whitespace-nowrap">{label}</span>
      )}
      {RATIOS.map((r) => {
        const disabled = !isAvailable({ scenario: scenarioType, control, ratio: r });
        const active = r === ratio;
        return (
          <button
            key={r}
            type="button"
            disabled={disabled}
            title={disabled ? NO_DATA_HINT : undefined}
            onClick={() => setRatio(r)}
            className={`h-6 min-w-8 rounded-md px-2 font-mono text-xs transition-colors ${
              active
                ? "bg-cyan-500 text-slate-900 shadow-sm"
                : disabled
                  ? "cursor-not-allowed text-slate-600"
                  : "cursor-pointer text-slate-400 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
};

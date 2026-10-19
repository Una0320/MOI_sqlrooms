import { useMapStore } from "@/zustand/useMapStore";
import { CollapsibleChoice } from "./CollapsibleChoice";

// 單位：分鐘
const WINDOW_OPTIONS = [15, 30, 60].map((m) => ({ value: m, label: `${m} min` }));

export const AdjustTimeWindow = () => {
  // 從 timeRange 寬度反推目前是哪個預設值：拖曳把手調出非預設寬度時，按鈕顯示 Custom
  const widthMin = useMapStore((s) => Math.round((s.timeRange[1] - s.timeRange[0]) / 60));
  const setTimeWindow = useMapStore((s) => s.setTimeWindow);

  return (
    <CollapsibleChoice
      title="Time window"
      options={WINDOW_OPTIONS}
      value={WINDOW_OPTIONS.some((o) => o.value === widthMin) ? widthMin : null}
      onChange={(m) => setTimeWindow(m * 60)}
    />
  );
};

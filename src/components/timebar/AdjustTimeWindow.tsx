import { useMapStore } from "@/zustand/useMapStore";
import { CollapsibleChoice } from "./CollapsibleChoice";

// 單位：分鐘
const WINDOW_OPTIONS = [15, 30, 60].map((m) => ({ value: m, label: `${m} min` }));

export const AdjustTimeWindow = () => {
  // 從 timeRange 寬度反推目前是哪個預設值：拖曳把手調出非預設寬度時，按鈕顯示 Custom
  // ⚠ Custom 的顯示邏輯保留不刪：但目前時間窗口的白色把手已停用（見 TimeLine.tsx），窗口寬度只能用這個按鈕的
  // 15 / 30 / 60 分鐘切換，因此不會出現非預設寬度，Custom 不會被觸發。恢復白色把手後它才會再出現。
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

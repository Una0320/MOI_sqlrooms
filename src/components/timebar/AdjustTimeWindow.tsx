import { useMapStore } from "@/zustand/useMapStore";
import { CollapsibleChoice } from "./CollapsibleChoice";

// 單位：分鐘
const WINDOW_OPTIONS = [15, 30, 60].map((m) => ({ value: m, label: `${m} min` }));

export const AdjustTimeWindow = () => {
  // 從 timeRange 寬度反推目前是哪個預設值；寬度不是 15 / 30 / 60 分鐘時按鈕顯示 Custom。
  // 窗口寬度只由這個按鈕決定：Timeline 的播放頭（拖曳 / 點擊）只改窗口終點、不改寬度，播放也保持寬度，
  // setTimeWindow 則固定終點、起點 = 終點 − 寬度。所以正常操作不會出現非預設寬度，Custom 實際上不會被觸發。
  // 僅剩的罕見路徑：用灰色把手把顯示範圍收得比「新選的寬度」還窄、且終點 < 新寬度時選這個寬度，
  // setTimeWindow 會把終點夾在顯示範圍末端，實際寬度就小於所選值 → Custom；另外，恢復舊的白色調寬把手後它也會再出現。
  // Custom 的顯示邏輯保留不刪。
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

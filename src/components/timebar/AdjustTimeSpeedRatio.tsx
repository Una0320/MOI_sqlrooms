import { useMapStore } from "@/zustand/useMapStore";
import { CollapsibleChoice } from "./CollapsibleChoice";

const SPEED_OPTIONS = [30, 60, 120, 240].map((r) => ({ value: r, label: `x${r}` }));

export const AdjustTimeSpeedRatio = () => {
  const timeScale = useMapStore((state) => state.timeScale);
  const setTimeScale = useMapStore((state) => state.setTimeScale);

  return (
    <CollapsibleChoice
      title="Speed"
      options={SPEED_OPTIONS}
      value={timeScale}
      onChange={setTimeScale}
    />
  );
};

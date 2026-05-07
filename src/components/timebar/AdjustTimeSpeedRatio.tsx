// 確保 shadcn/ui 的路徑正確
import { Button } from "@/components/ui/button";
import { useMapStore } from "@/zustand/useMapStore";

export const AdjustTimeSpeedRatio = () => {
  // 改用 Zustand
  const timeScale = useMapStore((state) => state.timeScale)
  const setTimeScale = useMapStore((state) => state.setTimeScale)

  return (
    <div className="flex items-center bg-[#1e1e24] border border-slate-700 rounded-lg p-1 gap-1">
      <span className="text-[11px] font-bold text-slate-500 px-2 uppercase tracking-widest">
        Ratio
      </span>
      
      {[30, 60, 120, 240].map((ratio) => {
        const isActive = timeScale === ratio;
        
        return (
          <Button 
            key={ratio}
            variant="ghost"
            size="sm"
            onClick={() => setTimeScale(ratio)}
            className={`
              h-7 px-2 text-xs font-mono rounded-md transition-all
              ${isActive 
                // 選中時：亮藍綠色背景 + 深色文字
                ? 'bg-cyan-500 text-slate-900 hover:bg-cyan-400 hover:text-slate-900 shadow-sm' 
                // 未選中時：暗色文字 + hover 效果
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }
            `}
          >
            x{ratio}
          </Button>
        );
      })}
    </div>
  );
};
import { Pause, Play } from "lucide-react";
// 確保 shadcn/ui 的路徑正確
import { Button } from "@/components/ui/button"; 
import { Card } from "@/components/ui/card"; 

import { useMapStore } from "@/zustand/useMapStore";
import { formatDurationTo24Hour } from "./utils";
import { TimeLine } from "./TimeLine";
import { AdjustTimeSpeedRatio } from "./AdjustTimeSpeedRatio";
import { useShallow } from "@sqlrooms/room-shell";

export const Timebar = () => {
  // 🌟 1. 改用 Zustand 提取所有需要的狀態與動作
  const { 
    isPlaying, 
    togglePlay, 
    timeRange, 
    displayTimeRange, 
    viewTimeRange, 
    setTimeRange, 
    setTime 
  } = useMapStore(useShallow((state) => ({
    isPlaying: state.isPlaying,
    togglePlay: state.togglePlay,
    timeRange: state.timeRange,
    displayTimeRange: state.displayTimeRange,
    viewTimeRange: state.viewTimeRange,
    setTimeRange: state.setTimeRange,
    setTime: state.setTime
  })));


  const handleTimerClick = () => {
    if (!isPlaying) {
      // 🌟 2. 如果時間已經到了結束點，重置回起點再播放
      if (timeRange[1] >= displayTimeRange[1]) {
        const width = timeRange[1] - timeRange[0];
        setTimeRange([displayTimeRange[0], displayTimeRange[0] + width]);
        setTime(displayTimeRange[0] + width); // 同步更新當前地圖時間
      }
    }
    // togglePlay 本身就會切換 true/false，所以不用分開寫 start/pause
    togglePlay();
  };

  return (
    // 🌟 3. 調整 shadcn Card 樣式，加入半透明黑與邊框，融入 Deck.gl 深色地圖
    <Card className="p-4 mt-4 select-none w-full bg-[#2B2B38]/90 border-slate-700 shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-4 mb-3">
        
        {/* 🌟 4. 使用 shadcn Button */}
        <Button 
          size="icon" 
          variant={isPlaying ? "secondary" : "default"} 
          onClick={handleTimerClick}
          className="w-10 h-10 transition-all hover:scale-105"
        >
          {isPlaying ? 
            <Pause size={18} className="fill-current" /> 
            : 
            <Play size={18} className="fill-current ml-1" />
          }
        </Button>
        
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Timeline
          </span>
          <div className="text-sm font-mono font-medium text-white">
            {formatDurationTo24Hour(timeRange[0]*1000)} - {formatDurationTo24Hour(timeRange[1]*1000)}
          </div>
        </div>

        {/* 靠右對齊倍速器 */}
        <div className="ml-auto text-sm font-mono font-medium">
          <AdjustTimeSpeedRatio />
        </div>
      </div>
      
      {/* 你的時間軸組件 */}
      <TimeLine />

      {/* Labels below slider */}
      <div className="flex justify-between text-[13px] text-slate-500 font-mono mt-2">
        <span>{formatDurationTo24Hour(viewTimeRange[0]*1000)}</span>
        <span>{formatDurationTo24Hour(viewTimeRange[1]*1000)}</span>
      </div>
    </Card>
  );
};
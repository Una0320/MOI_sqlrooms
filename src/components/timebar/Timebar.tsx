import { Pause, Play } from "lucide-react";
// 確保 shadcn/ui 的路徑正確
import { Button } from "@/components/ui/button"; 
import { Card } from "@/components/ui/card"; 
import { PANEL_FRAME } from "@/constants/layout";

import { useMapStore } from "@/zustand/useMapStore";
import { formatDurationTo24Hour } from "./utils";
import { TimeLine } from "./TimeLine";
import { AdjustTimeSpeedRatio } from "./AdjustTimeSpeedRatio";
import { AdjustTimeWindow } from "./AdjustTimeWindow";
import { RatioSelector } from "./RatioSelector";
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
    // padding/margin 縮小一點，讓 Timebar 整體矮一些——小螢幕時比較不容易蓋到右上角面板
    <Card className={`p-2 gap-0 mt-0 select-none w-full bg-[#2B2B38]/90 ring-0 shadow-xl ${PANEL_FRAME}`}>
      <div className="flex items-center gap-3 mb-2">

        {/* 🌟 4. 使用 shadcn Button */}
        <Button
          size="icon"
          variant={isPlaying ? "secondary" : "default"}
          onClick={handleTimerClick}
          className="w-7 h-7 transition-all hover:scale-105"
        >
          {isPlaying ?
            <Pause size={14} className="fill-current" />
            :
            <Play size={14} className="fill-current ml-0.5" />
          }
        </Button>
        
        <div className="flex shrink-0 flex-col whitespace-nowrap">
          <span className="text-[10px] leading-none font-bold text-slate-400 uppercase tracking-wider">
            Timeline
          </span>
          <div className="text-sm leading-tight font-mono font-medium text-white">
            {formatDurationTo24Hour(timeRange[0]*1000)} - {formatDurationTo24Hour(timeRange[1]*1000)}
          </div>
        </div>

        {/* 靠右對齊倍速器 */}
        <div className="ml-auto flex items-center gap-2 text-sm font-mono font-medium whitespace-nowrap">
          <RatioSelector />
          <AdjustTimeWindow />
          <AdjustTimeSpeedRatio />
        </div>
      </div>
      
      {/* 你的時間軸組件 */}
      <TimeLine />

      {/* Labels below slider */}
      <div className="flex justify-between text-[11px] leading-none text-slate-400 font-mono mt-1.5">
        <span>{formatDurationTo24Hour(viewTimeRange[0]*1000)}</span>
        <span>{formatDurationTo24Hour(viewTimeRange[1]*1000)}</span>
      </div>
    </Card>
  );
};
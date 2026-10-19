// 浮在地圖上的面板（右側面板、左上面板、圖例、Timeline、情境分頁）共用的版面常數。

// 左下角圖例與下方 Timeline 的底邊用同一個偏移，所以兩者底邊對齊（MainView.tsx）。
// 40 = MapLibre 右下角 attribution 的頂緣（高 24px + 離底 10px = 34px）+ 6px 間距：Timeline 右緣會延伸到
// attribution 上方，偏移太小（原本 20）會蓋住它的一角。
export const PANEL_BOTTOM_PX = 40;
// 圖例離畫面左緣的距離
export const PANEL_EDGE_PX = 20;
// 圖例顯示時，Timeline 的左邊界 = 圖例右緣 + 這個間距
export const LEGEND_TIMELINE_GAP_PX = 16;

// 所有浮動面板一致的外框：1px 半透明淺色邊線 + 背景模糊 + 同一個圓角。
// 不論底圖亮暗，面板邊界都靠這條淺色細線分出來。
export const PANEL_FRAME = 'rounded-lg border border-white/15 backdrop-blur-md';

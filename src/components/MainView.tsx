import { useEffect, useState } from 'react';
import { SpinnerPane } from '@sqlrooms/ui';
import { useSql } from '@sqlrooms/duckdb';

import { NO_DATA_HINT } from '../constants/data';
import { LEGEND_TIMELINE_GAP_PX, PANEL_BOTTOM_PX, PANEL_EDGE_PX } from '../constants/layout';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { MapView } from './MapView';
import { ModeSelector } from './ModeSelector';
import { LayerPanel } from './LayerPanel';
import { ScenarioSwitcher } from './ScenarioSwitcher';
import { NetworkControlToggle } from './NetworkControlToggle';
import { RoadServiceLegend } from './RoadServiceLegend';
import { RoadControlLegend } from './RoadControlLegend';
import { ShelterCapacityLegend } from './ShelterCapacityLegend';
import { Timebar } from './timebar/Timebar';

export const MainView: React.FC = () => {
  const { dataUrl } = useResolvedFiles();

  // 沒有軌跡資料的組合（混合避難 / 優先疏散 / 管制版…）：查一個零列的 SQL 讓 hook 保持有效，
  // 畫面上改顯示「此組合無資料」，不渲染地圖。
  const { data, isLoading, error } = useSql({
    query: dataUrl
      ? `SELECT paths, timestamps, modes FROM read_parquet('${dataUrl}')`
      : `SELECT CAST(NULL AS FLOAT[]) AS paths, CAST(NULL AS FLOAT[]) AS timestamps, CAST(NULL AS UTINYINT[]) AS modes WHERE false`,
  });

  const arrowTable = data?.arrowTable;

  // 左下角圖例堆疊的實際寬度（沒有任何圖例顯示時是 0）。Timeline 要用它決定左邊界要不要右移。
  const [legendEl, setLegendEl] = useState<HTMLDivElement | null>(null);
  const [legendWidth, setLegendWidth] = useState(0);
  useEffect(() => {
    if (!legendEl) return;
    const ro = new ResizeObserver(([entry]) => setLegendWidth(Math.round(entry.contentRect.width)));
    ro.observe(legendEl);
    return () => ro.disconnect();
  }, [legendEl]);

  // Timeline 原本是水平置中、寬 min(90%, 72rem)，左右邊界都是 sideMargin。
  // 圖例顯示時，左邊界改成 max(原本的左邊界, 圖例右緣 + 間距)——只在會重疊時才縮；圖例全部隱藏時回到原位。
  // left 加短 transition，圖例出現/消失時 Timeline 平滑縮放而不是跳動。
  const sideMargin = 'calc((100% - min(90%, 72rem)) / 2)';
  const timelineLeft =
    legendWidth > 0 ? `max(${sideMargin}, ${PANEL_EDGE_PX + legendWidth + LEGEND_TIMELINE_GAP_PX}px)` : sideMargin;

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#1e1e24]">
      {arrowTable && !isLoading ? (
        <>
          {/* 最底層：地圖 */}
          <div className="absolute inset-0 z-0">
            {dataUrl ? (
              <MapView arrowTable={arrowTable} />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-mono text-slate-400">
                {NO_DATA_HINT}
              </div>
            )}
          </div>

          {/* 正上方置中：情境類型切換 */}
          <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10">
            <ScenarioSwitcher />
          </div>

          {/* 右上角：運具選擇器 + 圖層控制。max-h + overflow-y-auto：小螢幕（視窗高度不夠）時
              這一疊面板自己捲動，不會往下長到蓋住 Timebar。
              ⚠ 190px 是量出來的：Timebar 實測高度 ~103px + PANEL_BOTTOM_PX(40px) + 這裡自己的
              top-5(20px) + ~25px 緩衝，面板才不會貼到邊界甚至疊到。改 Timebar 高度或 PANEL_BOTTOM_PX 時要
              一起調這個數字，不然又會蓋回去。 */}
          <div className="absolute top-5 right-5 z-10 flex w-[284px] flex-col gap-2 max-h-[calc(100vh-190px)] overflow-y-auto">
            <NetworkControlToggle />
            <ModeSelector />
            <LayerPanel />
          </div>

          {/* 正下方：時間軸 */}
          {dataUrl && (
            <div
              className="absolute z-10 transition-[left] duration-150 ease-out"
              style={{ bottom: PANEL_BOTTOM_PX, left: timelineLeft, right: sideMargin }}
            >
              <Timebar />
            </div>
          )}

          {/* 左下角圖例堆疊：Shelter Capacity、Road Control 在上，Road Service 固定在最下面。
              底邊與 Timeline 共用 PANEL_BOTTOM_PX（底邊對齊）；以底邊定位的 flex-col，
              只開其中一個時，那一個仍貼在最下方。各圖例自己在圖層沒開 / 沒資料時回傳 null。 */}
          <div
            ref={setLegendEl}
            className="absolute z-10 flex flex-col gap-2"
            style={{ bottom: PANEL_BOTTOM_PX, left: PANEL_EDGE_PX }}
          >
            <ShelterCapacityLegend />
            <RoadControlLegend />
            <RoadServiceLegend />
          </div>
        </>
      ) : (
        <SpinnerPane className="h-full w-full" />
      )}

      {/* 錯誤提示 */}
      {error && (
        <div className="absolute left-5 top-5 bg-red-500/90 text-white p-4 font-mono z-50 rounded shadow-lg backdrop-blur">
          {String(error)}
        </div>
      )}
    </div>
  );
};

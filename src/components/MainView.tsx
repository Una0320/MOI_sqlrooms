import { SpinnerPane } from '@sqlrooms/ui';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';

import { SCENARIO_CONFIG } from '../constants/data';
import { useMapStore } from '../zustand/useMapStore';
import { MapView } from './MapView';
import { ModeSelector } from './ModeSelector';
import { LayerPanel } from './LayerPanel';
import { ScenarioSwitcher } from './ScenarioSwitcher';
import { Timebar } from './timebar/Timebar';

export const MainView: React.FC = () => {
  const scenarioType = useMapStore(useShallow((s) => s.scenarioType));
  const dataUrl = SCENARIO_CONFIG[scenarioType].dataUrl;

  const { data, isLoading, error } = useSql({
    query: `SELECT paths, timestamps, modes FROM read_parquet('${dataUrl}')`,
  });

  const arrowTable = data?.arrowTable;

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#1e1e24]">
      {arrowTable && !isLoading ? (
        <>
          {/* 最底層：地圖 */}
          <div className="absolute inset-0 z-0">
            <MapView arrowTable={arrowTable} />
          </div>

          {/* 正上方置中：情境類型切換 */}
          <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10">
            <ScenarioSwitcher />
          </div>

          {/* 右上角：運具選擇器 + 圖層控制。max-h + overflow-y-auto：小螢幕（視窗高度不夠）時
              這一疊面板自己捲動，不會往下長到蓋住 Timebar。
              ⚠ 240px 是量出來的：Timebar 實測高度 ~177px + 它的 bottom-5(20px) + 這裡自己的
              top-5(20px) + ~20px 緩衝，兩個面板之間才不會貼到邊界甚至疊到。改 Timebar 高度時要
              一起調這個數字，不然又會蓋回去。 */}
          <div className="absolute top-5 right-5 z-10 flex flex-col gap-3 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
            <ModeSelector />
            <LayerPanel />
          </div>

          {/* 正下方：時間軸 */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[90%] z-10 max-w-6xl">
            <Timebar />
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

import { SpinnerPane } from '@sqlrooms/ui';
import { useSql } from '@sqlrooms/duckdb';

import { NO_DATA_HINT } from '../constants/data';
import { useResolvedFiles } from '../hooks/useResolvedFiles';
import { MapView } from './MapView';
import { ModeSelector } from './ModeSelector';
import { LayerPanel } from './LayerPanel';
import { ScenarioSwitcher } from './ScenarioSwitcher';
import { NetworkControlToggle } from './NetworkControlToggle';
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
              ⚠ 240px 是量出來的：Timebar 實測高度 ~177px + 它的 bottom-5(20px) + 這裡自己的
              top-5(20px) + ~20px 緩衝，兩個面板之間才不會貼到邊界甚至疊到。改 Timebar 高度時要
              一起調這個數字，不然又會蓋回去。 */}
          <div className="absolute top-5 right-5 z-10 flex flex-col gap-3 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
            <NetworkControlToggle />
            <ModeSelector />
            <LayerPanel />
          </div>

          {/* 正下方：時間軸 */}
          {dataUrl && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[90%] z-10 max-w-6xl">
              <Timebar />
            </div>
          )}
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

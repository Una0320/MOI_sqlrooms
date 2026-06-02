import { SpinnerPane } from '@sqlrooms/ui';
import { useSql } from '@sqlrooms/duckdb';

import { DATA_URL } from '../constants/data';
import { MapView } from './MapView';
import { ModeSelector } from './ModeSelector';
import { LayerPanel } from './LayerPanel';
import { Timebar } from './timebar/Timebar';

export const MainView: React.FC = () => {
  const { data, isLoading, error } = useSql({
    query: `SELECT paths, timestamps, modes FROM read_parquet('${DATA_URL}')`,
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

          {/* 右上角：運具選擇器 + 圖層控制 */}
          <div className="absolute top-5 right-5 z-10 flex flex-col gap-3">
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

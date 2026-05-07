import { SpinnerPane } from '@sqlrooms/ui';
import { useEffect, useState } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';

// 引入你的子組件
import { MapView } from './MapView';
import { ModeSelector } from './ModeSelector';
import { Timebar } from './timebar/Timebar';
// 記得確認你的 Timebar 路徑是否正確


export const MainView: React.FC = () => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadStandaloneDuckDB = async () => {
      try {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        
        const worker_url = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'text/javascript'})
        );
        const worker = new Worker(worker_url);
        
        const logger = new duckdb.ConsoleLogger();
        const standaloneDb = new duckdb.AsyncDuckDB(logger, worker);
        await standaloneDb.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(worker_url); 

        const conn = await standaloneDb.connect();
        
        // 🌟 對準你的本地端 API
        const sql = `
          SELECT paths, timestamps, modes
          FROM 'http://localhost:7780/data/abm_format_outcome_20000.parquet'
        `;
        const result = await conn.query(sql);
        await conn.close();

        if (isMounted) {
          // 🛡️ 絕對防禦：綁架到 window 避開 Vite 模組快取 Bug 與 Zustand 深度拷貝當機
          (window as any).globalArrowTable = result;
          setIsReady(true);
          console.log("✅ MainView：取得原生 Arrow 筆數:", result.numRows);
        }
      } catch (e) {
        if (isMounted) {
          console.error("引擎崩潰:", e);
          setError(String(e));
        }
      }
    };

    loadStandaloneDuckDB();

    return () => { isMounted = false; };
  }, []);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#1e1e24]">
      {isReady ? (
        <>
          {/* 最底層：地圖 */}
          <div className="absolute inset-0 z-0">
            <MapView />
          </div>

          {/* 右上角：運具選擇器 */}
          <ModeSelector />

          {/* 正下方：時間軸 (你原本的 Timebar) */}
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
          {error}
        </div>
      )}
    </div>
  );
};
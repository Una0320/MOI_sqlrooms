import * as duckdb from '@duckdb/duckdb-wasm';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';

/**
 * 【混合方案優化目的】
 * 原本的問題：setInterval 輪詢導致頻繁重渲染
 *
 * 現在的方案（DuckDBContext 層）：
 * - 使用 Promise 作為快取單位（不是結果狀態）
 * - 多個組件請求同一查詢時，共享同一個 Promise（解決競態條件）
 * - LRU 快取淘汰機制，防止記憶體無限增長
 *
 * Hook 層（useDuckDBTable）：
 * - 處理 Promise 的結果
 * - isMounted 檢查，安全處理組件卸載
 * - 完整的 loading/error 狀態管理
 */

// ============================================================================
// 【DuckDB 組態】
// ============================================================================
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdb_wasm,
    mainWorker: mvp_worker,
  },
  eh: {
    mainModule: duckdb_wasm_eh,
    mainWorker: eh_worker,
  },
};

// ============================================================================
// 【混合方案：Query 快取結構】
// 🔥 改進 1：快取結構改為儲存 Promise
// 優點：完全解決競態條件、支援 LRU 淘汰
// ============================================================================
interface CachedQuery {
  promise: Promise<any>;  // 儲存正在進行中或已完成的 Promise
  lastAccessed: number;   // 用於 LRU 淘汰機制
}

interface DuckDBContextType {
  // 【✅ 混合方案】queryTable 直接回傳 Promise
  // 優點：多個組件同時請求會共享同一個 Promise（解決競態）
  queryTable: (fileName: string, parquetUrl: string, sqlQuery: string) => Promise<any>;

  // 內部狀態 (除錯用)
  isInitialized: boolean;
  queryCache: Map<string, CachedQuery>;
}

// 🔥 改進 2：設定快取上限，避免記憶體無限增長
const MAX_CACHE_SIZE = 5; // 最多快取 5 個查詢結果

const DuckDBContext = createContext<DuckDBContextType | null>(null);

// ============================================================================
// 【Provider 組件】
// 在應用最頂層使用，確保全域只有一個 DuckDB 實例
// ============================================================================
export const DuckDBProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // DuckDB 全域實例 (初始化一次後永久保存)
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // 【快取】已註冊的 file URLs，避免重複註冊
  const registeredUrlsRef = useRef(new Set<string>());

  // 【快取】已查詢的 Tables，用 Promise 存儲
  // 🌟 關鍵：存儲 Promise 而不是結果，允許多個訂閱者共享同一個查詢
  const queryCacheRef = useRef(new Map<string, CachedQuery>());

  // ========================================================================
  // 【初始化 DuckDB - 只執行一次】
  // ========================================================================
  useEffect(() => {
    const init = async () => {
      try {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        const worker_url = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
        );
        const worker = new Worker(worker_url);
        const logger = new duckdb.ConsoleLogger();
        const newDb = new duckdb.AsyncDuckDB(logger, worker);
        await newDb.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(worker_url); 
        const newConn = await newDb.connect();

        setDb(newDb);
        setConn(newConn);
        setIsInitialized(true);
      } catch (error) {
        console.error('❌ DuckDB 初始化失敗:', error);
      }
    };

    init();

    // Cleanup
    return () => {
      // 不在卸載時關閉，因為這是全域實例
    };
  }, []);

  // ========================================================================
  // 【混合方案：核心方法 - 直接回傳 Promise】
  // 優點 1：完全解決競態條件 ✅
  //       多個組件請求同一查詢時，共享同一個 Promise
  // 優點 2：LRU 快取淘汰機制 ✅
  //       避免記憶體無限增長（最多快取 5 個查詢）
  // ========================================================================
  const queryTable = useCallback(
    async (fileName: string, parquetUrl: string, sqlQuery: string): Promise<any> => {
      // 檢查 DuckDB 是否初始化
      if (!conn || !db) {
        throw new Error('❌ DuckDB 尚未初始化');
      }

      const cacheKey = `${fileName}|${sqlQuery}`;
      const cacheMap = queryCacheRef.current;

      // ────────────────────────────────────────────────────────────────────
      // 【情況 1】🛡️ 快取命中！回傳同一個 Promise
      // 🌟 關鍵差異：多個組件同時請求會得到同一個 Promise
      //    這完全解決了原本的競態條件問題
      // ────────────────────────────────────────────────────────────────────
      if (cacheMap.has(cacheKey)) {
        const cached = cacheMap.get(cacheKey)!;
        cached.lastAccessed = Date.now(); // 📊 更新最後存取時間（用於 LRU）
        return cached.promise;
      }

      // ────────────────────────────────────────────────────────────────────
      // 【情況 2】🧹 LRU 快取淘汰機制
      // 當快取達到上限時，刪除最久未使用的查詢
      // ────────────────────────────────────────────────────────────────────
      if (cacheMap.size >= MAX_CACHE_SIZE) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        // 找出最久未訪問的快取項目
        for (const [key, value] of cacheMap.entries()) {
          if (value.lastAccessed < oldestTime) {
            oldestTime = value.lastAccessed;
            oldestKey = key;
          }
        }

        // 刪除最舊的快取項目
        if (oldestKey) {
          cacheMap.delete(oldestKey);
        }
      }

      // ────────────────────────────────────────────────────────────────────
      // 【情況 3】🚀 建立新的查詢 Promise
      // 🌟 關鍵：我們建立一個 Promise 並立即存入快取
      //    如果有其他組件此時也請求同一查詢，會得到同一個 Promise
      // ────────────────────────────────────────────────────────────────────
      const queryPromise = (async () => {
        try {
          // 註冊 File URL（每個 URL 只註冊一次）
          if (!registeredUrlsRef.current.has(parquetUrl)) {
            await db.registerFileURL(
              fileName,
              parquetUrl,
              duckdb.DuckDBDataProtocol.HTTP,
              false
            );
            registeredUrlsRef.current.add(parquetUrl);
          }

          const result = await conn.query(sqlQuery);
          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ Query 失敗 (${cacheKey}): ${errorMsg}`);
          throw new Error(errorMsg);
        }
      })();

      // 🌟 把「正在執行的 Promise」立刻存入快取！
      // 這樣其他組件如果也請求同一查詢，會得到同一個 Promise
      cacheMap.set(cacheKey, {
        promise: queryPromise,
        lastAccessed: Date.now(),
      });

      return queryPromise;
    },
    [conn, db]
  );

  // ✅ 混合方案：Context 只提供 queryTable（Promise-based）
  // Hook 層會在 useDuckDBTable 中處理 loading 狀態和組件卸載安全
  const value: DuckDBContextType = React.useMemo(
    () => ({
      queryTable,
      isInitialized,
      queryCache: queryCacheRef.current,
    }),
    [queryTable, isInitialized]
  );

  return (
    <DuckDBContext.Provider value={value}>
      {children}
    </DuckDBContext.Provider>
  );
};

// ============================================================================
// 【導出 Context Hook】
// 各個 Layer 組件使用這個 hook 來存取共享的 DuckDB
// ============================================================================
export const useDuckDB = () => {
  const context = useContext(DuckDBContext);
  if (!context) {
    throw new Error(
      '❌ useDuckDB 必須在 <DuckDBProvider> 內部使用'
    );
  }
  return context;
};

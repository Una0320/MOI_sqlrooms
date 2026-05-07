import { useEffect, useRef, useState } from 'react';
import { useDuckDB } from './DuckDBContext';

/**
 * 【useDuckDBTable Hook - React 層安全實作】
 * 
 * 混合方案第二部分：在 React Hook 層正確處理 Promise
 * 
 * 特點：
 * 1️⃣  isMounted 檢查：防止卸載後 setState（React 警告排查）
 * 2️⃣  完整的 loading/error/data 狀態
 * 3️⃣  依賴 DuckDBContext 層的 Promise 快取機制
 */

interface UseDuckDBTableResult {
  data: any;
  loading: boolean;
  error: string | null;
}

export function useDuckDBTable(
  fileName: string,
  parquetUrl: string,
  sqlQuery: string
): UseDuckDBTableResult {
  const { queryTable, isInitialized } = useDuckDB();

  // ========================================================================
  // 【狀態管理】
  // ========================================================================
  const [state, setState] = useState<UseDuckDBTableResult>({
    data: null,
    loading: true,
    error: null,
  });

  // 【🛡️ 核心：isMounted 檢查】
  // 用來追蹤組件是否仍然掛載（沒有被卸載）
  // 如果 isMounted = false，就不執行 setState，避免警告
  const isMountedRef = useRef(true);

  // ========================================================================
  // 【主要 Effect：取得資料】
  // 使用 DuckDBContext 層的 Promise-based queryTable
  // ========================================================================
  const effectiveSqlQuery = sqlQuery;

  useEffect(() => {
    // 如果 DuckDB 還沒初始化，直接返回（等待）
    if (!isInitialized) {
      return;
    }

    // 重置 mounted 標記（新的 effect 執行）
    isMountedRef.current = true;

    // 🚀 非同步函式：處理 Promise 結果
    const fetchData = async () => {
      try {
        // 💡 【關鍵】呼叫 DuckDBContext 層的 Promise-based queryTable
        // 如果多個組件同時請求同一查詢，會共享同一個 Promise
        // （混合方案 - DuckDB 層的 LRU 快取機制保證）
        const result = await queryTable(fileName, parquetUrl, effectiveSqlQuery);

        // 🛡️ 【安全檢查】如果組件已卸載，不執行 setState
        if (!isMountedRef.current) {
          return;
        }

        setState({
          data: result,
          loading: false,
          error: null,
        });
      } catch (err) {
        // 🛡️ 【安全檢查】如果組件已卸載，不執行 setState
        if (!isMountedRef.current) {
          return;
        }

        // ❌ 失敗：設定錯誤狀態
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        console.error(`❌ useDuckDBTable 查詢失敗 (${fileName}):`, errorMessage);
        setState({
          data: null,
          loading: false,
          error: errorMessage,
        });
      }
    };

    // 執行查詢
    fetchData();

    // ────────────────────────────────────────────────────────────────────
    // 【Cleanup 函式】組件卸載或依賴改變時執行
    // ────────────────────────────────────────────────────────────────────
    return () => {
      // 標記組件已卸載
      isMountedRef.current = false;
    };
  }, [fileName, parquetUrl, effectiveSqlQuery, isInitialized, queryTable]);

  return state;
}

/**
 * 【使用方式範例】
 *
 * const MyComponent = () => {
 *   const { data, loading, error } = useDuckDBTable(
 *     'my_data.parquet',
 *     'https://example.com/data.parquet',
 *     'SELECT * FROM read_parquet(?1) LIMIT 100'
 *   );
 *
 *   if (loading) return <div>載入中...</div>;
 *   if (error) return <div>錯誤: {error}</div>;
 *   if (!data) return <div>無資料</div>;
 *
 *   return (
 *     <div>
 *       查詢結果: {data.numRows} 行
 *     </div>
 *   );
 * };
 */

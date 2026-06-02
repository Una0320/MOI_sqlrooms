// 資料來源設定：統一從環境變數推導 parquet 來源，供 MainView 與 TimeLine 共用。
export const DATA_FILE_NAME =
  import.meta.env.VITE_DUCKDB_FILE_NAME || 'abm_format_outcome_20000.parquet';

export const DATA_BASE_URL =
  import.meta.env.VITE_DUCKDB_CONNECTION_STRING || 'http://localhost:7780/data';

export const DATA_URL = new URL(
  DATA_FILE_NAME,
  DATA_BASE_URL.endsWith('/') ? DATA_BASE_URL : DATA_BASE_URL + '/',
).href;

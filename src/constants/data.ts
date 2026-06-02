// 資料來源設定：統一從環境變數推導 parquet 來源，供 MainView 與 TimeLine 共用。
export const DATA_FILE_NAME =
  import.meta.env.VITE_DUCKDB_FILE_NAME || 'abm_format_outcome_20000.parquet';

export const DATA_BASE_URL =
  import.meta.env.VITE_DUCKDB_CONNECTION_STRING || 'http://localhost:7780/data';

const _baseUrl = DATA_BASE_URL.endsWith('/') ? DATA_BASE_URL : DATA_BASE_URL + '/';

export const DATA_URL = new URL(DATA_FILE_NAME, _baseUrl).href;

export const OD_FILE_NAME =
  import.meta.env.VITE_DUCKDB_OD_FILE_NAME || 'abm_od_arc_outcome.parquet';

export const OD_DATA_URL = new URL(OD_FILE_NAME, _baseUrl).href;

// 資料來源設定：base URL 從環境變數推導，實際檔名依「情境類型」查表（見 SCENARIO_CONFIG）。
export const DATA_BASE_URL =
  import.meta.env.VITE_DUCKDB_CONNECTION_STRING || 'http://localhost:7780';

const _baseUrl = DATA_BASE_URL.endsWith('/') ? DATA_BASE_URL : DATA_BASE_URL + '/';

const urlFor = (path: string) => new URL(path, _baseUrl).href;

// 靜態站點/避難所（02_points/，不隨情境變，詳見 sim_data/ 底下當前交付批次資料夾的 README.md §5 —— 資料夾名稱每次交付可能不同，不要假設是日期）
export const BUS_STOPS_URL = urlFor('02_points/bus_stops.csv');
export const METRO_STATIONS_URL = urlFor('02_points/metro_stations.csv');
export const SHELTERS_URL = urlFor('02_points/shelters.csv');

export type ScenarioType = 'shelter_in_place' | 'mass_evacuation';

export type ScenarioFileSet = {
  label: string;
  subScenario: string;
  dataUrl: string;
  odDataUrl: string;
  // 兩者依情境互斥（pt* 只有 stopCountsUrl、evac_ratio* 只有 shelterCapacityUrl），
  // 用不到的那個是 null；對應 hook 看到 null 會查一個保證 0 列的 SQL，不會因為檔案不存在而炸掉。
  stopCountsUrl: string | null;
  shelterCapacityUrl: string | null;
};

// 兩種頂層情境類型各自固定選一個子情境（10）代表；20/40 之後要做成下拉選單可以在這裡擴充成清單。
export const SCENARIO_CONFIG: Record<ScenarioType, ScenarioFileSet> = {
  mass_evacuation: {
    label: '大規模疏散',
    subScenario: 'pt10',
    dataUrl: urlFor('05_moi_sim/abm_format_outcome_10000_pt10.parquet'),
    odDataUrl: urlFor('05_moi_sim/abm_od_arc_outcome_10000_pt10.parquet'),
    stopCountsUrl: urlFor('03_stop_counts/stop_counts_pt10.parquet'),
    shelterCapacityUrl: null,
  },
  shelter_in_place: {
    label: '就地避難',
    subScenario: 'evac_ratio10',
    dataUrl: urlFor('05_moi_sim/abm_format_outcome_10000_evac_ratio10.parquet'),
    odDataUrl: urlFor('05_moi_sim/abm_od_arc_outcome_10000_evac_ratio10.parquet'),
    stopCountsUrl: null,
    shelterCapacityUrl: urlFor('04_shelter_capacity/shelter_capacity_evac_ratio10.parquet'),
  },
};

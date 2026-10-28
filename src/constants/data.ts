// 資料來源設定：base URL 從環境變數推導，實際檔案依「情境 × 路網管制 × 抽樣量」查 manifest
// （見 resolveFiles）。

export const DATA_BASE_URL =
  import.meta.env.VITE_DUCKDB_CONNECTION_STRING || 'http://localhost:7780';

const _baseUrl = DATA_BASE_URL.endsWith('/') ? DATA_BASE_URL : DATA_BASE_URL + '/';

const urlFor = (path: string) => new URL(path, _baseUrl).href;

// 靜態站點（02_points/，供 Stop Counts 圖層 join 座標用，不隨情境變，詳見 sim_data/ 底下當前交付批次資料夾的 README.md §5 —— 資料夾名稱每次交付可能不同，不要假設是日期）
export const BUS_STOPS_URL = urlFor('02_points/bus_stops.csv');
export const METRO_STATIONS_URL = urlFor('02_points/metro_stations.csv');

// ───────────────────────── 維度 ─────────────────────────

// 三個分頁：大規模撤離（s1）/ 混合避難（s2）/ 優先疏散（s3），各自有「無管制 / 有管制」兩場（交付批次 20261023）。
export type ScenarioType = 'mass_evacuation' | 'mixed_shelter' | 'priority_evac';
export type Control = 'none' | 'network_control';
// 軌跡與 OD 弧線的抽樣量（agent 數；小的是大的前段，六場抽到同一批戶）。
export type SampleSize = 10000 | 40000 | 50000 | 70000;

export const SCENARIO_ORDER: readonly ScenarioType[] = [
  'mass_evacuation',
  'mixed_shelter',
  'priority_evac',
];
export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  mass_evacuation: '大規模撤離',
  mixed_shelter: '混合避難',
  priority_evac: '優先疏散',
};
export const SAMPLE_SIZES: readonly SampleSize[] = [10000, 40000, 50000, 70000];
export const DEFAULT_SAMPLE_SIZE: SampleSize = 10000;

// 場次代碼：s1/s2/s3 × none/ctrl，對應交付批次的子資料夾與檔名
const SCENARIO_CODE: Record<ScenarioType, string> = {
  mass_evacuation: 's1',
  mixed_shelter: 's2',
  priority_evac: 's3',
};
const runOf = (scenario: ScenarioType, control: Control) =>
  `${SCENARIO_CODE[scenario]}_${control === 'network_control' ? 'ctrl' : 'none'}`;

export type FileKey = { scenario: ScenarioType; control: Control; sampleSize: SampleSize };

// ───────────────────────── manifest ─────────────────────────

// 每個欄位各自可為 null：圖層可用與否只看對應 url 是不是 null。
// null ＝「這個組合沒有這份資料」（設計上不存在，例如大規模撤離沒有收容所），不是忘了給。
export type FileSet = {
  dataUrl: string | null; //            05_moi_sim 軌跡（trips / 直方圖 / 撤離率）
  odDataUrl: string | null; //          05_moi_sim OD 飛線
  stopCountsUrl: string | null; //      03_stop_counts
  shelterCapacityUrl: string | null; // 04_shelter_capacity（只有混合避難、優先疏散）
  roadServiceUrl: string | null; //     06_road_service（逐小時，level 1–6）
  roadControlUrl: string | null; //     07_road_control（只有「有路網管制」的場，三場共用同一份）
  heatmapUrl: string | null; //         08_heatmap 每 5 分鐘 × 路段 × 運具的計數
  heatmapLinksUrl: string | null; //    08_heatmap/heatmap_links（線形，全場共用）
};

const EMPTY: FileSet = {
  dataUrl: null,
  odDataUrl: null,
  stopCountsUrl: null,
  shelterCapacityUrl: null,
  roadServiceUrl: null,
  roadControlUrl: null,
  heatmapUrl: null,
  heatmapLinksUrl: null,
};

// 檔案齊全的組合依規則組出路徑；沒有對應場次（例如抽樣量不在清單內）回 EMPTY。
export const resolveFiles = (key: FileKey): FileSet => {
  if (!SAMPLE_SIZES.includes(key.sampleSize)) return EMPTY;
  const run = runOf(key.scenario, key.control);
  const n = key.sampleSize;
  return {
    dataUrl: urlFor(`05_moi_sim/${run}/abm_format_outcome_a${n}_${run}.parquet`),
    odDataUrl: urlFor(`05_moi_sim/${run}/abm_od_arc_outcome_a${n}_${run}.parquet`),
    stopCountsUrl: urlFor(`03_stop_counts/stop_counts_${run}.parquet`),
    // 大規模撤離全數外圍撤離，沒有人去收容所
    shelterCapacityUrl:
      key.scenario === 'mass_evacuation' ? null : urlFor(`04_shelter_capacity/shelter_capacity_${run}.parquet`),
    roadServiceUrl: urlFor(`06_road_service/road_service_${run}.parquet`),
    roadControlUrl: key.control === 'network_control' ? urlFor('07_road_control/road_control.parquet') : null,
    heatmapUrl: urlFor(`08_heatmap/heatmap_${run}.parquet`),
    heatmapLinksUrl: urlFor('08_heatmap/heatmap_links.parquet'),
  };
};

// 這個組合有沒有軌跡資料（所有圖層都建立在軌跡之上，沒有就視為整個組合無資料）
export const isAvailable = (key: FileKey): boolean => resolveFiles(key).dataUrl !== null;

// 目前交付批次六場 × 四種抽樣量都齊全，所以分頁永遠可點；保留這個函式讓日後缺檔時 UI 不用改。
export const isScenarioAvailable = (scenario: ScenarioType, control: Control): boolean =>
  SAMPLE_SIZES.some((sampleSize) => isAvailable({ scenario, control, sampleSize }));

// UI 提示文字
export const NO_DATA_HINT = '此組合無資料';
export const NOT_PROVIDED_HINT = '資料尚未提供';

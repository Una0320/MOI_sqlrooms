// 資料來源設定：base URL 從環境變數推導，實際檔案依「情境 × 路網管制 × 規模(ratio)」查 manifest
// （見 resolveFiles）。

export const DATA_BASE_URL =
  import.meta.env.VITE_DUCKDB_CONNECTION_STRING || 'http://localhost:7780';

const _baseUrl = DATA_BASE_URL.endsWith('/') ? DATA_BASE_URL : DATA_BASE_URL + '/';

const urlFor = (path: string) => new URL(path, _baseUrl).href;

// 靜態站點（02_points/，供 Stop Counts 圖層 join 座標用，不隨情境變，詳見 sim_data/ 底下當前交付批次資料夾的 README.md §5 —— 資料夾名稱每次交付可能不同，不要假設是日期）
export const BUS_STOPS_URL = urlFor('02_points/bus_stops.csv');
export const METRO_STATIONS_URL = urlFor('02_points/metro_stations.csv');

// ───────────────────────── 維度 ─────────────────────────

// 大規模撤離 = pt*（原「大規模疏散」）；就近避難 = evac_ratio*（原「就地避難」，暫時保留）；
// 混合避難 / 優先疏散 目前沒有任何資料檔（manifest 全 null、分頁 disabled）。
export type ScenarioType = 'mass_evacuation' | 'mixed_shelter' | 'priority_evac' | 'nearest_shelter';
export type Control = 'none' | 'network_control';
export type Ratio = 10 | 20 | 40;

// 分頁（UI）上顯示的情境與順序。'nearest_shelter'（evac_ratio*）的 manifest 與資料檔路徑都還在，
// 只是暫時不放進分頁；要放回來只要把它加回這個陣列。
export const SCENARIO_ORDER: readonly ScenarioType[] = [
  'mass_evacuation',
  'mixed_shelter',
  'priority_evac',
];
export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  mass_evacuation: '大規模撤離',
  mixed_shelter: '混合避難',
  priority_evac: '優先疏散',
  nearest_shelter: '就近避難',
};
export const RATIOS: readonly Ratio[] = [10, 20, 40];

export type FileKey = { scenario: ScenarioType; control: Control; ratio: Ratio };

// ───────────────────────── manifest ─────────────────────────

// 每個欄位各自可為 null：圖層可用與否只看對應 url 是不是 null，不綁情境、
// 也不假設 stopCounts 與 shelterCapacity 互斥（現在只是剛好 pt 有前者、evac_ratio 有後者）。
// null ＝「這個組合沒有這份資料」（可能是設計上不存在，也可能是還沒交付），不是忘了給。
export type FileSet = {
  dataUrl: string | null; //            05_moi_sim 軌跡（trips / 直方圖 / heatmap / 撤離率）
  odDataUrl: string | null; //          05_moi_sim OD 飛線
  stopCountsUrl: string | null; //      03_stop_counts
  shelterCapacityUrl: string | null; // 04_shelter_capacity
  roadServiceUrl: string | null; //     05_moi_sim/road_service_*.geojson（尖峰小時靜態 V/C）
  // 左上角完成率的算法（見 hooks/useEvacuationRate.ts）：
  //   'people_weighted' — 「Evac Rate」：一列 = 一個 agent，car agent 算 4 人、其餘 1 人（evac_ratio）
  //   'leg_count'       — 同樣顯示「Evac Rate」，但 hover 說明以移動段計：pt* 的列是 leg、05 又沒有 person_id，只能以移動段計
  //                       （不是人員撤離率）
  //   null — 沒有軌跡資料的組合，不顯示
  evacuationRate: 'people_weighted' | 'leg_count' | null;
};

const EMPTY: FileSet = {
  dataUrl: null,
  odDataUrl: null,
  stopCountsUrl: null,
  shelterCapacityUrl: null,
  roadServiceUrl: null,
  evacuationRate: null,
};

const keyOf = (k: FileKey) => `${k.scenario}|${k.control}|${k.ratio}`;

// 目前交付批次（20260916）有的資料；沒列在這裡的組合一律是 EMPTY。
// 之後交付新檔（管制版、混合避難、優先疏散、其他 ratio 的 road_service…）只要在這裡加一筆。
const MANIFEST: Record<string, FileSet> = {};
for (const r of RATIOS) {
  // 大規模撤離（pt*）：有候車人潮與站點；沒有避難所飽和率（旅次終點不是避難所，README §5）。
  // road_service 只有 pt20 一份。
  MANIFEST[keyOf({ scenario: 'mass_evacuation', control: 'none', ratio: r })] = {
    ...EMPTY,
    dataUrl: urlFor(`05_moi_sim/abm_format_outcome_10000_pt${r}.parquet`),
    odDataUrl: urlFor(`05_moi_sim/abm_od_arc_outcome_10000_pt${r}.parquet`),
    stopCountsUrl: urlFor(`03_stop_counts/stop_counts_pt${r}.parquet`),
    roadServiceUrl: r === 20 ? urlFor('05_moi_sim/road_service_pt20.geojson') : null,
    evacuationRate: 'leg_count',
  };
  // 就近避難（evac_ratio*）：有避難所飽和率；零大眾運輸所以沒有候車人潮（README §5）。
  MANIFEST[keyOf({ scenario: 'nearest_shelter', control: 'none', ratio: r })] = {
    ...EMPTY,
    dataUrl: urlFor(`05_moi_sim/abm_format_outcome_10000_evac_ratio${r}.parquet`),
    odDataUrl: urlFor(`05_moi_sim/abm_od_arc_outcome_10000_evac_ratio${r}.parquet`),
    shelterCapacityUrl: urlFor(`04_shelter_capacity/shelter_capacity_evac_ratio${r}.parquet`),
    evacuationRate: 'people_weighted',
  };
}

export const resolveFiles = (key: FileKey): FileSet => MANIFEST[keyOf(key)] ?? EMPTY;

// 這個組合有沒有軌跡資料（所有圖層都建立在軌跡之上，沒有就視為整個組合無資料）
export const isAvailable = (key: FileKey): boolean => resolveFiles(key).dataUrl !== null;

export const availableRatios = (scenario: ScenarioType, control: Control): Ratio[] =>
  RATIOS.filter((ratio) => isAvailable({ scenario, control, ratio }));

// 分頁是否可點：該情境在目前的管制設定下至少有一個 ratio 有資料
export const isScenarioAvailable = (scenario: ScenarioType, control: Control): boolean =>
  availableRatios(scenario, control).length > 0;

// UI 提示文字
export const NO_DATA_HINT = '此組合無資料';
export const NOT_PROVIDED_HINT = '資料尚未提供';

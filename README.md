# 修改MOI_Simulation => MOI_SQLRooms

這是一個基於 **React**、**Deck.gl** 與 **DuckDB WASM** 構建的高效能城市移動軌跡動態可視化系統。專為處理海量（20,000+ 筆）Agent-Based Modeling (ABM) 軌跡數據而設計，實現了零拷貝（Zero-copy）渲染與即時 SQL 聚合分析。現在延伸成一個防災情境視覺化工具：畫面正上方可以在「就地避難」與「大規模疏散」兩種情境之間切換，各自帶出自己的軌跡資料、OD 起迄弧線，以及情境專屬的疊圖（公車/捷運站點候車人潮、避難所收容飽和率）。

## 🏗️ 核心架構 (System Architecture)

本系統採用 **Hybrid Data Pipeline** 架構，確保在瀏覽器端處理百萬級頂點時，仍能保持 60 FPS 的極致流暢度。

### 1. 數據層 (Data Layer)
* **本地 Node.js 後端**: 透過 HTTP 提供 `.parquet`/`.csv` 檔案，支援 **Range Requests**，允許 DuckDB 僅抓取所需的數據分片，減少網路傳輸負載。
* **DuckDB WASM**: 在瀏覽器內運行的 SQL 引擎，直接讀取並解析 Parquet/CSV 格式，將結果轉化為 **Apache Arrow** 記憶體格式。
* **資料 manifest**: `src/constants/data.ts` 的 `resolveFiles({scenario, control, ratio})` 依「情境 × 路網管制 × 規模(10/20/40)」查 manifest，每個檔案欄位（軌跡、OD、候車人潮、避難所飽和率、Road Service、站點/避難所標記）各自可為 `null`。畫面上的情境分頁、ratio 按鈕與 Network Control 開關只是改變 Zustand 裡的狀態，所有查詢都會自動重打。

### 2. 狀態管理 (State Management)
* **Zustand**: 取代傳統 Redux，負責輕量級的 UI 狀態（包含時間軸、播放控制、運具過濾、圖層開關、目前的情境類型）。
* **Global Context (Singleton)**: 確保全域只有一個 DuckDB 實例與 Worker，避免記憶體溢位，並透過 Promise 攔截實作了查詢快取 (LRU Cache) 與防併發註冊機制。

### 3. 渲染層 (Rendering Layer)
* **Deck.gl + Custom ArrowTripsLayer**: 自定義圖層直接讀取 Arrow Vector 底層記憶體，徹底繞過 CPU 的 JSON 解析過程，將數據「零拷貝」傳遞給 GPU。
* **supercluster 動態聚合**: 站點候車人潮圖層依目前地圖 zoom 動態合併/展開泡泡，縮小時聚合成大泡泡、放大時逐漸拆回個別站牌，避免密集站點互相重疊看不清楚。
* **shadcn/ui**: 構建現代化、反應靈敏的互動控制面版（Timebar, ModeSelector, LayerPanel, ScenarioSwitcher）。

---

## ✨ 關鍵技術特性 (Key Features)

| 特性 | 技術細節 | 效益 |
| :--- | :--- | :--- |
| **零拷貝渲染 (Zero-Copy)** | `ArrowTripsLayer` 直接讀取底層 Buffer | 消除大量資料轉 JSON 的記憶體暴增與延遲 |
| **高效能過濾 (Bitmask)** | WebGL Shader + 二進位運具過濾 | 在 GPU 內實現毫秒級的顯示模式切換 |
| **動態時間軸 (Timebar)** | 雙層區間控制 (Display/Active Range) | 提供專業級的數據觀測解析度，支援區間平移 (Panning) |
| **即時直方圖 (Histogram)**| DuckDB SQL 聚合 (Bins) | 視覺化時間軸上的數據分佈密度，動態自適應資料邊界 |
| **情境 / 路網管制** | 情境分頁（大規模撤離／混合避難／優先疏散）+ Network Control 開關，由 manifest 決定每個組合有哪些檔案（ratio 預設 20；就近避難 evac_ratio 的 manifest 與資料路徑保留，只是不在分頁上） | 沒資料的分頁、圖層一律 disabled 並提示（「資料尚未提供」／「此組合無資料」），不隱藏；切換即時重載並重置時間軸 |
| **完成率 (Evac Rate)** | 左上角 `Evac Rate`（標籤固定這個寫法），累計值、二分搜尋查表；evac_ratio 用人數口徑（car=4），pt 以移動段(leg)計，hover 說明資料缺 person_id、非嚴格的人員撤離率 | 看撤離進度隨時間的變化 |
| **站點候車人潮聚合** | supercluster 依 zoom 動態分群 + 圈內數字標示 | 縮小看全貌、放大看單站細節，不會被上千個重疊圓圈洗版 |
| **面板配置** | 右上 Network Control 滑動開關 + Mobility Modes + Layers（Trips／Heatmap／OD Arc／Shelter Capacity／Road Service／Stop Counts，寬 284px、可收合）；左上 Time（HH:MM:SS）／Zoom／Evac Rate（只有完成率的數值是 `#DF9651`）；左下圖例堆疊（Shelter Capacity 在上、Road Service LOS 固定在最下）；下方 Timeline 約 103px 高，與圖例底邊對齊（圖例顯示時 Timeline 左緣右移到圖例右側）；所有面板統一 1px 半透明淺色邊線 + backdrop-blur | 面板精簡不擋地圖；沒資料的圖層 disabled 並提示 |
| **圖層 Tooltip** | Stop-Counts 候車泡泡／Shelter-Capacity 飽和率圈都可 hover | 不用另外查表就能核對站點候車人數與避難所收容飽和度 |
| **道路服務水準 (Road Service)** | 靜態尖峰 V/C：線色依 LOS A–F、線寬依 √log(1+V/C)，圖層開啟時顯示 legend（標題 ROAD SERVICE (LOS)＋「道路服務水準」；A–F 連成一條連續色條，右邊是字母與中文說明，不顯示任何數值，寬度固定 232px。LOS 色碼 A #44C23A／B #1FB33B／C #DFD34E／D #DF9651／E #D15528／F #C22E00，圖例與地圖共用同一組常數） | 一眼看出壅塞路段；放在所有圖層最底層當背景。資料來源 `05_moi_sim/road_service_<情境>.geojson`，目前只有 pt20 一份，預設的大規模撤離（ratio 20）可勾，沒有檔的組合該選項會 disabled 並標「此組合無資料」 |
| **時間窗口 / 倍速 / pt 選擇器** | Timeline 右側由左到右：pt 選擇器（左邊標籤 + 10／20／40 分段按鈕攤開，標籤文字來自 manifest 的 `RATIO_LABELS`，沒資料的選項 disabled 並提示「此組合無資料」，切換時重置時間軸，預設 20）、Time window（15/30/60 分鐘）、Speed（x30/x60/x120/x240）；窗口寬度只能用 Time window 按鈕調整——時間窗口左右的白色把手已用註解停用（程式碼保留，恢復方式與原因寫在 `TimeLine.tsx` 的註解與 CLAUDE.md；恢復時是已調細的版本：視覺 4px、感應區 12px），窗口本體仍可拖曳平移（窗口起點／終點仍以白色細條顯示，純視覺、不能拖曳；最頭與最尾的灰色把手改成 2px 細線、高度與外框相同），所以「Custom」不會出現 | 時間軸面板更精簡；ratio 的意義待資料端確認，所以不加說明文字 |
| **移動點位 Tooltip** | 「移動軌跡」圖層放大後（zoom > 11）切成逐點顯示，可看路徑編號/運具/即時時速，時速過低會標「塞車/等待中」或「緩慢移動」 | 不用隱藏停滯的點也能用滑鼠找出卡在哪一段的路徑 |

---

## 🚀 安裝與設定 (Installation & Setup)

### 1. 前端環境變數 (.env)
請在專案根目錄建立 `.env` 檔案，並填入以下內容（請勿加引號）：

```env
VITE_DUCKDB_CONNECTION_STRING=http://localhost:7780

# 選填：不填就 fallback 回 CARTO dark-matter 底圖
VITE_MAPTILER_API_KEY=
```

實際會讀哪些檔案（trips / OD arc / 站點候車人潮 / 避難所容量 / Road Service），是由 `src/constants/data.ts` 的 manifest（`resolveFiles`）依畫面上選的情境、ratio 與路網管制決定，不用另外在 `.env` 裡指定檔名。

`VITE_MAPTILER_API_KEY` 是選填的底圖來源設定：到 [MapTiler](https://cloud.maptiler.com/account/keys/) 免費申請一組 key 填進去，地圖底圖會換成 MapTiler 的 `dataviz-dark` 樣式（OSM 資料每週重建一次）；不填的話會 fallback 回原本的 CARTO `dark-matter-gl-style`（該底圖官方文件寫最慢一年才更新一次，新完工的路橋等建設可能好幾個月都看不到）。

底圖設定集中在 `src/constants/basemap.ts`。開發時（`yarn dev`）可以在網址加 `?basemap=<名稱>` 試不同底圖：`current`（現行，預設）／`dark`（CARTO dark-matter 無文字）／`positron`（CARTO 淺色）／`nlsc`（國土測繪中心 EMAP 點陣圖磚，已降彩度與亮度）。四個選項的載入都用程式檢查過（style / 圖磚請求皆 HTTP 200、console 無錯誤；nlsc 31 個圖磚請求回應中位數約 0.18 秒、最慢約 0.29 秒）。早期試看的初步印象（最後由你自己用 `?basemap=` 切換決定）：`dark` 對比最高但沒有地名、`positron` 太亮（白色軌跡會消失，不適合）、`nlsc` 底圖文字太雜；預設仍維持 `current`，等選定後再改。

### 2. 安裝系統依賴
請確保你的環境已安裝 Node.js，然後執行以下指令：

```bash
# 安裝套件
yarn install
```

### 3. 準備本機測試資料
本機開發用的測試資料放在 `sim_data/` 底下的單一交付批次資料夾（已加入 `.gitignore`，不隨 repo 一起走，需要另外跟專案負責人索取一份）。資料夾名稱每次交付可能不同，不一定是日期格式，請以實際拿到的為準（目前是 `sim_data/20260916/`）。

⚠️ **這一步不能跳過**：`clone` 下來的專案預設沒有這個資料夾。如果直接 `yarn dev` 卻沒有先準備好 `sim_data/` 並啟動下面的資料伺服器，前端畫面會卡在 Loading 轉圈，或是左上角跳出紅色錯誤訊息（類似 `IO Error: Could not connect to server ...`）——這是 DuckDB-WASM 連不到 `VITE_DUCKDB_CONNECTION_STRING` 指到的資料伺服器，不是程式壞掉，把資料夾補齊、伺服器啟動起來就會恢復正常。

準備好資料夾之後，啟動一個支援 Range Requests + CORS 的靜態伺服器指到這個資料夾：

```bash
npx http-server sim_data/<交付批次資料夾> -p 7780 --cors   # 例：sim_data/20260916，請以本機實際資料夾名稱為準
```

### 4. 啟動服務
本系統需要同時啟動資料伺服器（上一步）與前端開發環境（建議開兩個終端機視窗）：

```bash
# 前端：啟動 Vite 開發環境
yarn dev
```

打開 http://localhost:5173 應該就能看到地圖畫面。

### 5. 其他指令

```bash
yarn build    # tsc -b && vite build，輸出正式版到 dist/
yarn lint     # eslint .
yarn preview  # 本機預覽 build 出來的 dist/
```

部署目標是 Netlify（見 `netlify.toml`）：`yarn build` → 上傳 `dist/`，設定裡有 `CI=false` 跟加大的 Node heap（處理大量 Parquet/Arrow 資料時避免 build 階段記憶體不足）。

---

## 🧠 開發者備註 (Dev Notes)

* **時間單位基準**: 全系統統一使用 **「秒 (Seconds)」** 作為基準單位，包含 Zustand Store 與 DuckDB 查詢。請避免混入 JavaScript 原生的毫秒 (ms) 計算。部分情境（`pt*`/`evac_ratio*`）的時間戳可能超過 86400（模擬跑到 72 小時）。
* **渲染效能優化**: 在監聽 Zustand 狀態（如 `MapView` 與 `TimeLine`）時，已全面導入 `@sqlrooms/room-shell` 提供的 `useShallow` 與原子化 Selector，確保地圖播放時不會觸發無效的 UI 重新渲染 (Re-renders)。
* **併發控制防禦**: 在 `DuckDBContext` 中實作了「註冊鎖 (Registration Lock)」。當多個圖層同時發起查詢時，會共用同一個 VFS 註冊 Promise，防止虛擬檔案系統因併發寫入而損毀 (`Invalid URL` 錯誤)。
* **地圖縮放範圍**: 目前限制在 zoom 10~15 之間（`constants/map.ts` 的 `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM`），超過這個範圍對目前的資料精細度沒有意義。

---

## 📝 TODO

* **Timebar 依 mode 過濾直方圖**: 目前 `TimeLine.tsx` 的直方圖 query 只用 `timestamps` 統計每個 bin 的 agent 數量，未讀取 `modes` 欄位，也未接上 `selectedModes` state；勾選/取消 ModeSelector 的運具不會影響時間軸下方的長條圖分布。
  * 方案 A（SQL 端）：query 依 `selectedModes` 動態組 `WHERE modes ...`，直方圖只統計符合的 agent。
  * 方案 B（JS 端）：一次撈出 timestamp 對應的 mode，前端依 `selectedModes` 重新計算直方圖，避免每次切換都重打 DuckDB。
* **混合避難／優先疏散／路網管制資料（等數據工程確認後補檔）**: 這三者目前沒有任何檔案（manifest 全 `null`，分頁與 Network Control 開關 disabled）。UI 與圖層邏輯都已經由 manifest 驅動，**交付後只要在 `src/constants/data.ts` 的 `MANIFEST` 加對應的一筆，不用改 UI**。下面是先定義好的接口與檔案清單，**檔名全部是「暫定」，以數據工程最後確認為準**。
  * **接口（不用新開，沿用現有的）**
    * 查檔：`resolveFiles({ scenario, control, ratio }) → FileSet`（`data.ts`）。key 是 `scenario|control|ratio`，沒列在 manifest 的組合一律回傳全 `null`。
    * `scenario` 值：`mixed_shelter`（混合避難）、`priority_evac`（優先疏散）；`control` 值：`none` / `network_control`；`ratio`：`10 | 20 | 40`。
    * `FileSet` 每個欄位各自可為 `null`，圖層可不可用只看對應 url 是不是 `null`（`LAYER_CONFIG[].requires`）：`dataUrl`、`odDataUrl`、`stopCountsUrl`、`shelterCapacityUrl`、`roadServiceUrl`，另外 `evacuationRate` 要指定算法（`'people_weighted'` / `'leg_count'`）。
    * 讀取：所有 hook 都經過 `hooks/useResolvedFiles.ts` 拿 url，不直接讀 manifest。
    * 讀檔位置：url = `VITE_DUCKDB_CONNECTION_STRING`（預設 `http://localhost:7780`）+ 下表的相對路徑，伺服器要支援 Range 與 CORS（跟現有資料相同）。
  * **每個情境需要的檔案（相對於資料根目錄；`<tag>` 為待確認的檔名前綴）**

    | 檔案用途 | FileSet 欄位 | 暫定路徑 | 必要？ |
    |:--|:--|:--|:--|
    | 軌跡（trips / 直方圖 / heatmap / Evac Rate） | `dataUrl` | `05_moi_sim/abm_format_outcome_10000_<tag><ratio>.parquet` | **必要**（沒有它整個組合視為無資料） |
    | OD 起訖弧線 | `odDataUrl` | `05_moi_sim/abm_od_arc_outcome_10000_<tag><ratio>.parquet` | 選用 |
    | 站點候車人潮 | `stopCountsUrl` | `03_stop_counts/stop_counts_<tag><ratio>.parquet` | 選用（有大眾運輸才有） |
    | 避難所飽和率 | `shelterCapacityUrl` | `04_shelter_capacity/shelter_capacity_<tag><ratio>.parquet` | 選用（**驗證 Shelter Capacity 圖層要靠這個**） |
    | 道路服務水準 | `roadServiceUrl` | `05_moi_sim/road_service_<tag><ratio>.geojson` | 選用 |
    | Evac Rate 算法 | `evacuationRate` | （不是檔案，在 manifest 指定） | 有 `dataUrl` 就要填 |

    * 路網管制版（`control = network_control`）：同樣的檔案各一份，檔名建議在 `<tag><ratio>` 後加 `_nc`（暫定）。需要 `NetworkControlToggle` 解除停用的條件是「該情境至少一個 ratio 有管制版 `dataUrl`」。
  * **待數據工程確認的項目**
    1. 混合避難、優先疏散各自的檔名前綴 `<tag>`（現有的是 `pt`、`evac_ratio`）。
    2. 這兩個情境的 `ratio` 是否仍是 10/20/40，意義是否與 `pt` 相同（Timeline 的 ratio 選擇器標籤由 `data.ts` 的 `RATIO_LABELS` 指定，沒填就只顯示 10/20/40）。
    3. 每個情境有哪些選用檔案（候車人潮、避難所飽和率、道路服務水準）；目前只有 `evac_ratio*` 有避難所飽和率，`pt*` 有候車人潮。
    4. `evacuationRate` 用哪個口徑：有 `person_id` 且一列一人就可以用人數口徑；跟 `pt*` 一樣以 leg 為列則用 `leg_count`。
    5. 檔案內欄位是否維持現有契約（軌跡：`paths` / `timestamps` / `modes`；避難所：`shelter_id` / `shelter_name` / `capacity` / `timestamps` / `current_count` / `load_ratio` / `status` / `X` / `Y`）。欄位有變就要改對應 hook 的 SQL。
    6. 「就近避難」（`evac_ratio*`）的資料是否改歸給這兩個情境之一；目前它的 manifest 與檔案路徑保留，但不在分頁（`SCENARIO_ORDER`）裡。
  * **拿到檔案後的步驟**：(1) 把檔案放進資料根目錄；(2) 在 `data.ts` 的 `MANIFEST` 加 `{ scenario, control, ratio }` 對應的 `FileSet`（檔案沒有的欄位保持 `null`）；(3) 若要顯示 ratio 標籤，填 `RATIO_LABELS[scenario]`；(4) 重新整理，分頁自動啟用，各 layer 依 url 是否為 `null` 自動啟用或停用，不用改 UI。
* **道路服務水準圖層補資料**: 圖層已接上（`useRoadServiceLayer`），但交付批次只有 `road_service_pt20.geojson`，所以只有「大規模撤離」ratio 20 可用，其他 ratio 與情境的勾選框 disabled。拿到其他檔案後補進 manifest 的 `roadServiceUrl` 即可。
* **`01_trajectory` 逐運具拆檔**: 目前 trips/OD 都是走 `05_moi_sim` 的相容格式（單檔含全部運具），`01_trajectory`（每運具獨立、欄位更豐富，例如 `dist_road_m`/`is_teleport_walk`）還沒用上。

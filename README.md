# 修改MOI_Simulation => MOI_SQLRooms

這是一個基於 **React**、**Deck.gl** 與 **DuckDB WASM** 構建的高效能城市移動軌跡動態可視化系統。專為處理海量（20,000+ 筆）Agent-Based Modeling (ABM) 軌跡數據而設計，實現了零拷貝（Zero-copy）渲染與即時 SQL 聚合分析。

## 🏗️ 核心架構 (System Architecture)

本系統採用 **Hybrid Data Pipeline** 架構，確保在瀏覽器端處理百萬級頂點時，仍能保持 60 FPS 的極致流暢度。

### 1. 數據層 (Data Layer)
* **本地 Node.js 後端**: 透過 HTTP 提供 `.parquet` 檔案，支援 **Range Requests**，允許 DuckDB 僅抓取所需的數據分片，減少網路傳輸負載。
* **DuckDB WASM**: 在瀏覽器內運行的 SQL 引擎，直接讀取並解析 Parquet 格式，將結果轉化為 **Apache Arrow** 記憶體格式。

### 2. 狀態管理 (State Management)
* **Zustand**: 取代傳統 Redux，負責輕量級的 UI 狀態（包含時間軸、播放控制、運具過濾）。
* **Global Context (Singleton)**: 確保全域只有一個 DuckDB 實例與 Worker，避免記憶體溢位，並透過 Promise 攔截實作了查詢快取 (LRU Cache) 與防併發註冊機制。

### 3. 渲染層 (Rendering Layer)
* **Deck.gl + Custom ArrowTripsLayer**: 自定義圖層直接讀取 Arrow Vector 底層記憶體，徹底繞過 CPU 的 JSON 解析過程，將數據「零拷貝」傳遞給 GPU。
* **shadcn/ui**: 構建現代化、反應靈敏的互動控制面版（Timebar, ModeSelector）。

---

## ✨ 關鍵技術特性 (Key Features)

| 特性 | 技術細節 | 效益 |
| :--- | :--- | :--- |
| **零拷貝渲染 (Zero-Copy)** | `ArrowTripsLayer` 直接讀取底層 Buffer | 消除 20,000 筆資料轉 JSON 的記憶體暴增與延遲 |
| **高效能過濾 (Bitmask)** | WebGL Shader + 二進位運具過濾 | 在 GPU 內實現毫秒級的顯示模式切換 |
| **動態時間軸 (Timebar)** | 雙層區間控制 (Display/Active Range) | 提供專業級的數據觀測解析度，支援區間平移 (Panning) |
| **即時直方圖 (Histogram)**| DuckDB SQL 聚合 (Bins) | 視覺化時間軸上的數據分佈密度，動態自適應資料邊界 |

---

## 🚀 安裝與設定 (Installation & Setup)

### 1. 前端環境變數 (.env)
請在專案根目錄建立 `.env` 檔案，並填入以下內容（請勿加引號）：

```env
VITE_DUCKDB_FILE_NAME=abm_format_outcome_20000.parquet
VITE_DUCKDB_CONNECTION_STRING=http://localhost:7780/data
```

### 2. 安裝系統依賴
請確保你的環境已安裝 Node.js，然後執行以下指令：

```bash
# 安裝套件
yarn install
```

### 3. 啟動服務
本系統需要同時啟動資料伺服器與前端開發環境：

```bash
# 前端：啟動 Vite 開發環境
yarn dev
```

---

## 🧠 開發者備註 (Dev Notes)

* **時間單位基準**: 全系統統一使用 **「秒 (Seconds)」** 作為基準單位 (0 - 86400)，包含 Zustand Store 與 DuckDB 查詢。請避免混入 JavaScript 原生的毫秒 (ms) 計算。
* **渲染效能優化**: 在監聽 Zustand 狀態（如 `MapView` 與 `TimeLine`）時，已全面導入 `@sqlrooms/room-shell` 提供的 `useShallow` 與原子化 Selector，確保地圖播放時不會觸發無效的 UI 重新渲染 (Re-renders)。
* **併發控制防禦**: 在 `DuckDBContext` 中實作了「註冊鎖 (Registration Lock)」。當多個圖層同時發起查詢時，會共用同一個 VFS 註冊 Promise，防止虛擬檔案系統因併發寫入而損毀 (`Invalid URL` 錯誤)。
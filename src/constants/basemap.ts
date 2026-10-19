import type { StyleSpecification } from 'maplibre-gl';

// 底圖設定集中在這裡。MapView 只讀 BASEMAP_STYLE。
//
// 開發時可用 URL 參數 ?basemap=<名稱> 試不同底圖（只在 `yarn dev` 生效，正式 build 一律用預設）：
//   current  — 現行底圖：有 VITE_MAPTILER_API_KEY 用 MapTiler dataviz-dark（每週重建），沒有則 fallback CARTO dark-matter
//   dark     — CARTO dark-matter 無文字版（dark-matter-nolabels）
//   positron — CARTO positron（淺色）
//   nlsc     — 國土測繪中心 EMAP（臺灣通用電子地圖）點陣圖磚，降彩度、降亮度
// 預設底圖維持 'current'，等選定後再改 DEFAULT_BASEMAP。

export type BasemapName = 'current' | 'dark' | 'positron' | 'nlsc';
export const DEFAULT_BASEMAP: BasemapName = 'current';

// CARTO 的 dark-matter-gl-style 底層 OSM 資料官方文件寫最慢一年才重建一次（快則 3–6 個月），
// 淡江大橋這種新完工的建設即使 OSM 上已經有人畫了，也可能好幾個月看不到——所以現行底圖優先用 MapTiler
// 的 dataviz-dark（專為深色資料視覺化設計），資料每週重建一次。
// 沒設定 VITE_MAPTILER_API_KEY 時 fallback 回 CARTO，避免沒申請 key 的人本機起不來。
const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY as string | undefined;

if (!MAPTILER_API_KEY) {
  console.warn(
    '[basemap] VITE_MAPTILER_API_KEY 未設定，現行底圖 fallback 回 CARTO dark-matter（資料較舊）。' +
      '到 https://cloud.maptiler.com/account/keys/ 申請免費 key 後填進 .env 即可換成每週更新的 MapTiler 底圖。',
  );
}

const CARTO = 'https://basemaps.cartocdn.com/gl';

// 國土測繪中心 WMTS：端點 https://wmts.nlsc.gov.tw/wmts、圖層 EMAP、TileMatrixSet GoogleMapsCompatible。
// 圖磚 URL 是讀 GetCapabilities 裡 EMAP 的 ResourceURL template 得到的：
//   https://wmts.nlsc.gov.tw/wmts/EMAP/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}
// Style=default、TileMatrixSet=GoogleMapsCompatible，TileMatrix=z、TileRow=y、TileCol=x（注意 y 在 x 前面）。
// 圖磚為 image/jpeg、回應帶 access-control-allow-origin: *。實測 z10–z18 都有圖磚。
const NLSC_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    nlsc: {
      type: 'raster',
      tiles: ['https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
      attribution: '國土測繪中心',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#1e1e24' } },
    {
      id: 'nlsc-emap',
      type: 'raster',
      source: 'nlsc',
      // EMAP 是高彩度的淺色地圖，原樣放進來會搶過軌跡與弧線：降彩度、壓低最亮的亮度，
      // 讓整張圖變成偏暗的灰階底圖。
      paint: {
        'raster-saturation': -0.8,
        'raster-brightness-max': 0.45,
        'raster-brightness-min': 0,
        'raster-contrast': 0.1,
      },
    },
  ],
};

export const BASEMAP_STYLES: Record<BasemapName, string | StyleSpecification> = {
  current: MAPTILER_API_KEY
    ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_API_KEY}`
    : `${CARTO}/dark-matter-gl-style/style.json`,
  dark: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
  positron: `${CARTO}/positron-gl-style/style.json`,
  nlsc: NLSC_STYLE,
};

const resolveBasemapName = (): BasemapName => {
  if (!import.meta.env.DEV) return DEFAULT_BASEMAP;
  const q = new URLSearchParams(window.location.search).get('basemap');
  return q && q in BASEMAP_STYLES ? (q as BasemapName) : DEFAULT_BASEMAP;
};

export const BASEMAP_STYLE = BASEMAP_STYLES[resolveBasemapName()];

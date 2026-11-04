import type { createMosaicSlice } from '@sqlrooms/mosaic';

// @sqlrooms/mosaic 0.29.0-rc.1 的 index 沒有匯出 MosaicSliceState，從 createMosaicSlice 的回傳型別推出來。
// 放在獨立檔案（不 import store.ts），避免 store ↔ components 的循環 import。
export type MosaicSliceState = ReturnType<ReturnType<typeof createMosaicSlice>>;

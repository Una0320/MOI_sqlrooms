import {
  CompositeLayer,
  CompositeLayerProps,
  DefaultProps,
  GetPickingInfoParams,
  Layer,
  LayersList
} from '@deck.gl/core';
import { DataFilterExtension, MaskExtension } from '@deck.gl/extensions';
import type { TripsLayerProps } from '@deck.gl/geo-layers';
import { PathLayer } from '@deck.gl/layers';
import * as arrow from 'apache-arrow';
import { ArrowPickingInfo } from '../types';
import { ArrowExtraPickingProps, computeChunkOffsets, getPickingInfo } from '../utils/picking';
import { assignAccessor, extractAccessorsFromProps } from '../utils/utils';
import { HeatmapDataFilterExtension } from '../arrowTripsLayer/utils/extensions';


export type ArrowPathLayerProps = Omit<
  TripsLayerProps<arrow.Table>,
  'data' | 'getPath' | 'getTimestamps' | 'getFilter' | 'getFilterValue'
> &
  _ArrowPathLayerProps &
  CompositeLayerProps;

/** Properties added by ArrowScatterplotLayer */
type _ArrowPathLayerProps = {
  data: arrow.Table;
  /**
   * If `true`, validate the arrays provided (e.g. chunk lengths)
   * @default true
   */
  _validate?: boolean;
  /**
   * @default 'paths'
   */
  getPathColumn?: string;
  /**
   * @default 'timestamps'
   */
  getTimestampColumn?: string;
  /**
   * @default 'modes'
   */
  getModeColumn?: string;
  
  timeRange: [number, number]
  
  filterCategories: number[];
};

// 移除 upstream 預設值干擾
const {
  data: _data,
  getPath: _getPath,
  getWidth: _getWidth,
  ..._upstreamDefaultProps
} = PathLayer.defaultProps;
// TODO: check defaultProps

// Default props added by us
const ourDefaultProps = {
  _validate: true,
  _pathType: 'open',
  getPathColumn: 'paths',
  getTimestampColumn: 'timestamps',
  getModeColumn: 'modes',
  timeRange: [11000, 12000],
  filterCategories: [2]
};

// @ts-expect-error
const defaultProps: DefaultProps<ArrowPathLayerProps> = {
  ..._upstreamDefaultProps,
  ...ourDefaultProps
};

export class ArrowPathLayer<ExtraProps extends object = object> extends CompositeLayer<
  ArrowPathLayerProps & ExtraProps
> {
  static defaultProps = defaultProps;
  static layerName = 'ArrowPathLayer';

  static dataFilterExtension = new HeatmapDataFilterExtension({ 
    filterSize: 1, 
    categorySize: 1 
  });

  // 保留 Picking 邏輯
  getPickingInfo(
    params: GetPickingInfoParams & {
      sourceLayer: { props: ArrowExtraPickingProps };
    }
  ): ArrowPickingInfo {
    return getPickingInfo(params, this.props.data);
  }

  renderLayers(): Layer | null | LayersList {
    const { data: table } = this.props;
    if (!table || !table.batches || table.batches.length === 0) return null;
    return this._renderLayersPaths(table);
  }

  _renderLayersPaths(table: arrow.Table): Layer<object> | LayersList | null {
    const {
      id,
      getPathColumn,
      getModeColumn,
      getTimestampColumn,
      timeRange,
      filterCategories
    } = this.props;

    // 保留 Accessor 提取邏輯
    const [accessors, otherProps] = extractAccessorsFromProps(this.props, ['getTimestamps', 'getPath']);
    
    // 保留 Chunk Offsets 計算 (Picking 必備)
    const tableOffsets = computeChunkOffsets(table.data);

    const layers: PathLayer<any>[] = [];

    // =========================================================
    // 轉換過濾條件 (Map Filter)
    // =========================================================
    // [為何要轉換？] 
    // UI 傳進來的 filterCategories 是 Bitmask 數值 (例如: 1=走路, 2=開車, 4=腳踏車... 1024=某新載具)
    // 但 Deck.gl 的 DataFilterExtension 底層是用 GPU 位元運算 (1 << categoryId) 來實作開關。
    // GPU 的 Filter Mask 只有 128-bit，如果直接傳入 1024，會叫 GPU 去開「第 1024 號開關」導致崩潰。
    // 因此，這裡必須用 Math.log2 將稀疏的 Bitmask (1, 2, 4, 8) 壓回連續的索引 (0, 1, 2, 3)，
    // 確保開關永遠在 0~127 的安全範圍內。
    const mappedFilterCategories = filterCategories.map(cat => {
      if (cat <= 0) return -1;
      return Math.floor(Math.log2(cat)); 
    });

    // 遍歷 Batches
    for (let recordBatchIdx = 0; recordBatchIdx < table.batches.length; recordBatchIdx++) {

      // 使用統一的 recordBatchIdx 讀取資料
      const pathData = table.batches[recordBatchIdx].getChild(getPathColumn!);
      const timestampData = table.batches[recordBatchIdx].getChild(getTimestampColumn!);
      const modesData = table.batches[recordBatchIdx].getChild(getModeColumn!);

      if (!pathData) {
        console.warn(`[ArrowPathLayer] Batch ${recordBatchIdx} 遺失 paths 欄位`);
        continue;
      }

      // =========================================================
      // 🔥 幾何對齊與正規化
      // =========================================================

      const srcOffsets = pathData.data[0].valueOffsets;
      const srcCoords = pathData.data[0].children[0].values;
      const numPaths = pathData.length;

      // [計算基準點：Arrow 記憶體連續性]
      // Apache Arrow 為了極致效能，整個 Parquet 檔案的座標會被壓平成一條超長的連續一維陣列 (values)。
      // srcOffsets 陣列紀錄了「這一批次 (Batch)」的座標，在那個超長一維陣列中的「絕對起點與終點」。
      const baseOffset = Number(srcOffsets[0]);
      const endOffset = Number(srcOffsets[srcOffsets.length - 1]);

      // [A. 重建 Offsets (startIndices)]
      // Deck.gl 的 PathLayer 需要知道每一條線由幾個「頂點」組成。
      // 轉換公式：(原始絕對Offset - 基準Offset) / 2
      // 1. 減去 baseOffset: 將全域的絕對索引，轉換為這個 Batch 專用的「相對索引」。
      // 2. 除以 2: 因為 Arrow 的 offsets 算的是「Float 數量」(x, y 佔 2 個 Float)，
      //    但 Deck.gl 的 startIndices 算的是「頂點數量」(1 個點)。所以必須除以 2。
      const cleanStartIndices = new Uint32Array(numPaths + 1);
      for (let k = 0; k < srcOffsets.length; k++) {
        cleanStartIndices[k] = (Number(srcOffsets[k]) - baseOffset) / 2;
      }

      // [B. 計算屬性長度 (Attribute Bounds)]
      // 每個頂點佔用 2 個 Float (x, y)，但每個頂點對應的時間 (Timestamp) 和模式 (Mode) 只有 1 個 Float/Uint。
      // 所以屬性視圖的範圍，剛好會是座標範圍的一半。
      const attrBase = baseOffset / 2;
      const attrEnd = endOffset / 2;

      // [C. 建立座標視圖 (Coordinates View)]
      // 使用 .subarray 進行 Zero-Copy 切片。
      // 只把這個 Batch 需要的座標段落傳給 GPU，避免 GPU 讀到超出範圍的垃圾記憶體導致畫面亂飛。
      const pathView = (srcCoords as Float32Array).subarray(baseOffset, endOffset);

      // [D. 切片時間 (Timestamp View)]
      let timestampView;
      if (timestampData) {
        const tsValues = timestampData.data[0].children[0].values as Float32Array;
        // 同理，根據算好的 attrBase/attrEnd 切出剛好對應頂點數量的時間陣列
        timestampView = tsValues.subarray(attrBase, attrEnd);
      } else {
        // Fallback: 如果缺漏時間欄位，給予等長的空陣列防呆，防止 WebGL 屬性長度不匹配而 Crash
        timestampView = new Float32Array(attrEnd - attrBase);
      }

      // [E. 切片與轉換模式 (Mode View & Log2)]
      let modeIndexView = new Uint8Array(attrEnd - attrBase); 
      let modeView;
      if (modesData) {
        const modeValues = modesData.data[0].children[0].values as Uint8Array;
        modeView = modeValues.subarray(attrBase, attrEnd);
        // 為了將資料端的 Bitmask (1, 2, 4) 同步壓縮回 Index (0, 1, 2)，與上方的 mappedFilterCategories 對齊。
        // GPU 驗證邏輯：當 GPU 讀到 '2' (原本的4)，它就會去檢查 DataFilterExtension 裡的「第 2 號開關」是否開啟。
        for (let k = 0; k < modeView.length; k++) {
          const val = modeView[k];
          if (val > 0) {
              modeIndexView[k] = Math.floor(Math.log2(val));
          } else {
              modeIndexView[k] = 255; // 255 是 Uint8 的最大值，用來代表無效值，會自然被過濾器擋下
          }
        }
      } else {
        modeIndexView.fill(255);
      }

      // 計算 Batch Offset
      const batchOffset = tableOffsets[recordBatchIdx] ?? 0;

      // =========================================================
      // 3. 建立圖層屬性
      // =========================================================

      const layerProps: any = {
        ...ourDefaultProps, 
        ...otherProps,      
        
        id: `${id}-batch-${recordBatchIdx}`,
        recordBatchIdx: recordBatchIdx,
        tableOffsets: tableOffsets, 

        data: {
          length: numPaths,
          startIndices: cleanStartIndices, 
          attributes: {
            getPath: { value: pathView, size: 2 }, 
            getFilterValue: { value: timestampView, size: 1 },
            getFilterCategory: { value: modeIndexView, size: 1, type: 'uint8' },
          }
        },

        extensions: [ArrowPathLayer.dataFilterExtension, new MaskExtension()],
        filterEnabled: true,
        filterRange: timeRange,
        filterCategories: mappedFilterCategories,
        maskId: "geofence",

        widthMinPixels: 1,
      };

      // 處理其他 Accessor
      for (const [propName, propInput] of Object.entries(accessors)) {
        assignAccessor({
          props: layerProps,
          propName,
          propInput,
          chunkIdx: recordBatchIdx,
          batchOffset
        });
      }

      layers.push(new PathLayer(layerProps));
    }
    
    return layers;
  }
}

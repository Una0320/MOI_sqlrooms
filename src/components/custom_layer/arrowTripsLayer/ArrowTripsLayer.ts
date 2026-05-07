import {
  CompositeLayer,
  CompositeLayerProps,
  DefaultProps,
  GetPickingInfoParams,
  Layer,
  LayersList
} from '@deck.gl/core';
import { TripsLayer, TripsLayerProps } from '@deck.gl/geo-layers';
import * as arrow from 'apache-arrow';
import { ArrowPickingInfo, ExtensionProps } from '../types';
import { ArrowExtraPickingProps, computeChunkOffsets, getPickingInfo } from '../utils/picking';
import { assignAccessor, extractAccessorsFromProps } from '../utils/utils';
import { ModeObjectPropsExtension } from './utils/extensions';

export type ArrowTripsLayerProps = Omit<
  TripsLayerProps<arrow.Table>,
  'data' | 'getPath' | 'getTimestamps' | 'getColor'
> & _ArrowTripsLayerProps & CompositeLayerProps;

type _ArrowTripsLayerProps = {
  data: arrow.Table;
  getPathColumn?: string;
  getTimestampColumn?: string;
  getModeColumn?: string;
  filterBitMask: number[];
  colorMap?: number[];
};

const defaultProps: DefaultProps<ArrowTripsLayerProps> = {
  getPathColumn: 'paths',
  getTimestampColumn: 'timestamps',
  getModeColumn: 'modes',
  currentTime: 0,
  trailLength: 9999,
  filterBitMask: [0xFFFFFFFF],
};

export class ArrowTripsLayer<ExtraProps extends object = object> extends CompositeLayer<
  ArrowTripsLayerProps & ExtraProps
> {
  static defaultProps = defaultProps;
  static layerName = 'ArrowTripsLayer';

  declare state: {
    // 存放精確計算過 baseOffset 的 Indices
    cleanIndicesArray: Uint32Array[];
  };

  // 使用 params 接住全部參數 (包含隱藏的 context)
  updateState(params: any) {
    // 1. 原封不動把整包參數交給父類別，這樣就不會報錯了
    super.updateState(params);

    // 2. 從 params 裡面解構出我們自己邏輯需要的東西
    const { props, changeFlags } = params;

    // 3. 結合快取機制與 Offset 邏輯
    if (changeFlags.dataChanged && props.data) {
      const table = props.data;
      const cleanIndicesArray: Uint32Array[] = [];

      for (const batch of table.batches) {
        const pathCol = batch.getChild(props.getPathColumn);
        if (!pathCol) continue;

        const srcOffsets = pathCol.data[0].valueOffsets;
        const numPaths = pathCol.length;
        const baseOffset = Number(srcOffsets[0]); 

        const cleanStartIndices = new Uint32Array(numPaths + 1);
        for (let k = 0; k < srcOffsets.length; k++) {
          cleanStartIndices[k] = (Number(srcOffsets[k]) - baseOffset) / 2;
        }
        cleanIndicesArray.push(cleanStartIndices);
      }
      this.setState({ cleanIndicesArray });
    }
  }

  renderLayers(): Layer | null | LayersList {
    const { data: table } = this.props;
    if (!table || !this.state.cleanIndicesArray) return null;
    return this._renderLayersPaths(table);
  }

  _renderLayersPaths(table: arrow.Table): Layer<object> | LayersList | null {
    const {
      id,
      currentTime,
      getPathColumn,
      getTimestampColumn,
      getModeColumn,
      filterBitMask,
      colorMap
    } = this.props;

    const [accessors, otherProps] = extractAccessorsFromProps(this.props, ['getTimestamps', 'getPath']);
    const tableOffsets = computeChunkOffsets(table.data);
    const layers: Layer<any>[] = [];

    for (let i = 0; i < table.batches.length; i++) {
      const batch = table.batches[i];
      const pathCol = batch.getChild(getPathColumn!);
      const tsCol = batch.getChild(getTimestampColumn!);
      const modeCol = batch.getChild(getModeColumn!);

      if (!pathCol || !tsCol || !modeCol) continue;

      // 🏆 採用下半段的 subarray 邏輯，確保記憶體邊界正確
      const srcOffsets = pathCol.data[0].valueOffsets;
      const baseOffset = Number(srcOffsets[0]);
      const endOffset = Number(srcOffsets[srcOffsets.length - 1]);
      const attrBase = baseOffset / 2;
      const attrEnd = endOffset / 2;

      // 嚴格型別斷言與切片 (Subarray)
      const rawCoords = pathCol.data[0].children[0].values as Float32Array;
      const pathView = rawCoords.subarray(baseOffset, endOffset);

      const rawTs = tsCol.data[0].children[0].values as Float32Array;
      const tsView = rawTs.subarray(attrBase, attrEnd);

      const rawModes = modeCol.data[0].children[0].values as Uint8Array;
      const modeView = rawModes.subarray(attrBase, attrEnd);

      layers.push(
        new TripsLayer({
          ...otherProps,
          id: `${id}-batch-${i}`,
          data: {
            length: pathCol.length,
            // 這裡直接取用 updateState 算好的快取
            startIndices: this.state.cleanIndicesArray[i],
            attributes: {
              getPath: { value: pathView, size: 2 },
              getTimestamps: { value: tsView, size: 1 },
              // ✅ 修正：必須叫 mode_type 才能對應到你的 Shader
              mode_type: { value: modeView, size: 1 } 
            }
          },
          extensions: [new ModeObjectPropsExtension()],
          bitmask: filterBitMask, // ✅ 單一數字
          colorMap: colorMap,
          currentTime: currentTime,
        })
      );
    }
    return layers;
  }

  getPickingInfo(params: GetPickingInfoParams & { sourceLayer: { props: ArrowExtraPickingProps } }): ArrowPickingInfo {
    return getPickingInfo(params, this.props.data);
  }
}
// import {
//   CompositeLayer,
//   CompositeLayerProps,
//   DefaultProps,
//   GetPickingInfoParams,
//   Layer,
//   LayersList
// } from '@deck.gl/core';
// import type { TripsLayerProps } from '@deck.gl/geo-layers';
// import { TripsLayer } from '@deck.gl/geo-layers';

// import * as arrow from 'apache-arrow';

// // import { DataFilterExtension } from '@deck.gl/extensions';
// // import { ArrowTable } from '@loaders.gl/arrow';
// import { ArrowPickingInfo, ExtensionProps } from '../types';
// import { ArrowExtraPickingProps, computeChunkOffsets, getPickingInfo } from '../utils/picking';
// import { assignAccessor, extractAccessorsFromProps } from '../utils/utils';
// import { ModeObjectPropsExtension } from './utils/extensions';
// import path from 'path';



// export type ArrowTripsLayerProps = Omit<
//   TripsLayerProps<arrow.Table>,
//   'data' | 'getPath' | 'getTimestamps' | 'getColor' | 'getFilter' | 'getFilterValue'
// > &
//   _ArrowTripsLayerProps &
//   CompositeLayerProps;

// /** Properties added by ArrowScatterplotLayer */
// type _ArrowTripsLayerProps = {
//   data: arrow.Table;

//   /**
//    * If `true`, validate the arrays provided (e.g. chunk lengths)
//    * @default true
//    */
//   _validate?: boolean;
//   /**
//    * @default 'paths'
//    */
//   getPathColumn?: string;
//   /**
//    * @default 'timestamps'
//    */
//   getTimestampColumn?: string;
//   /**
//    * @default 'modes'
//    */
//   getModeColumn?: string;
//   /**
//    * @default [31]
//    */
//   filterBitMask: number[]
//   /**
//    * @default true
//    */
//   filterEnabled?: boolean
//   /**
//    * @default [r1,g1,b1,a1,r2,g2,b2,a2,...]
//    */
//   colorMap?: number[]

//   // TODO: need to support custom accessors(?)
//   /**
//    * @default Float32Array
//    */
//   // getTimestamps?: arrow.Vector
// };

// // Remove data and getPosition from the upstream default props
// const {
//   data: _data,
//   getPath: _getPath,
//   getTimestamps: _getTimestamps,
//   ..._upstreamDefaultProps
// } = TripsLayer.defaultProps;
// // TODO: check defaultProps

// // Default props added by us
// const ourDefaultProps = {
//   _validate: true,
//   _pathType: 'open',
//   getPathColumn: 'paths',
//   getTimestampColumn: 'timestamps',
//   getModeColumn: 'modes',
//   trailLength: 120, 
// };

// // @ts-expect-error
// const defaultProps: DefaultProps<ArrowTripsLayerProps> = {
//   ..._upstreamDefaultProps,
//   ...ourDefaultProps
// };


// export class ArrowTripsLayer<ExtraProps extends object = object> extends CompositeLayer<
//   ArrowTripsLayerProps & ExtraProps
// > {
//   static defaultProps = defaultProps;
//   static layerName = 'ArrowTripsLayer'; // 在 Deck.gl 中註冊圖層名稱

//   // 新增 state 來存放算好的 indices
//   state!: {
//     cleanIndicesArray: Uint32Array[];
//   };

//   // 用 params 接住全部，再傳給 super
//   updateState(params: any) {
//     // 1. 原封不動把整包參數交給父類別
//     super.updateState(params);

//     // 2. 從 params 裡面解構出需要的東西
//     const { props, changeFlags } = params;

//     // 3. 執行高效能快取邏輯
//     if (changeFlags.dataChanged && props.data) {
//       const table = props.data;
//       const cleanIndicesArray: Uint32Array[] = [];

//       for (let i = 0; i < table.batches.length; i++) {
//         // @ts-ignore (如果 getChild 報錯的話可以加上這個)
//         const pathData = table.batches[i].getChild(props.getPathColumn);
//         const srcOffsets = pathData.data[0].valueOffsets;
//         const cleanIndices = new Uint32Array(srcOffsets.length);
        
//         for (let k = 0; k < srcOffsets.length; k++) {
//           cleanIndices[k] = srcOffsets[k] / 2;
//         }
//         cleanIndicesArray.push(cleanIndices);
//       }

//       this.setState({ cleanIndicesArray });
//     }
//   }

//   /**
//    * 覆蓋 getPickingInfo 方法以處理點擊事件 (picking)。
//    * @param params
//    * @returns
//    */
//   getPickingInfo(
//     params: GetPickingInfoParams & {
//       sourceLayer: {props: ArrowExtraPickingProps};
//     }
//   ): ArrowPickingInfo {
//     return getPickingInfo(params, this.props.data);
//   }

//   renderLayers(): Layer<object> | LayersList | null {
//     const {
//       data: table
//     } = this.props;

//     // @ts-ignore
//     if(!table || table?.length === 0) return null;
//     return this._renderLayersPaths(table)

//     // throw new Error('Not getting any data');
//   }
//  /**
//    * 內部方法：專門處理 Vector 的渲染
//    * @param table 偵測到或傳入的 arrow.Table
//    */
//   _renderLayersPaths(
//     table: arrow.Table
//   ): Layer<object> | LayersList | null {
//     const {
//       id,
//       currentTime,
//       getPathColumn,
//       getModeColumn,
//       getTimestampColumn,
//       filterBitMask,
//       colorMap
//     } = this.props

//     // 如果上層有傳入的話
//     const [accessors, otherProps] = extractAccessorsFromProps(this.props, ['getTimestamps', 'getPath'])

//     // 計算整個 table (所有 batch) 的累計偏移量，主要用於 picking
//     const tableOffsets = computeChunkOffsets(table.data)

//     const layers: TripsLayer<any>[] = []

//     // 從 state 拿 updateState 生命週期中，只算過一次並快取起來的 Indices
//     const { cleanIndicesArray } = this.state;
    
//     // =========================================================================
//     // 【Batch 迴圈機制】
//     // 為什麼要有迴圈？因為 Apache Arrow 為了防止記憶體爆炸，會把巨量資料（例如幾十萬筆）
//     // 自動切分成多個 "RecordBatch" (資料區塊)。必須逐一把這些區塊送給 GPU。
//     // =========================================================================
//     for (let recordBatchIdx = 0; recordBatchIdx < table.batches.length; recordBatchIdx++) {
//       // 1. 取得當前 Batch 的 path 欄位物件
//       const pathData = table.batches[recordBatchIdx].getChild(getPathColumn)
//       // =====================================================================
//       // 【拿到最底層的連續記憶體】
//       // Python 端存的是 pa.list_()，所以在 Arrow JS 底層，它被包裝成了多層結構：
//       // .data[0] -> .children[0] -> .values (這才是真正的 Float32Array 或 Uint8Array)
//       // 在這裡直接把它剝開，拿出最核心的陣列。
//       // =====================================================================
//       const timestampData = table.batches[recordBatchIdx].getChild(getTimestampColumn).data[0].children[0].values
//       const modesData = table.batches[recordBatchIdx].getChild(getModeColumn).data[0].children[0].values

//       // @ts-expect-error how to properly retrieve batch offset?
//       const batchOffset = pathData._offsets[recordBatchIdx]
//       const props: TripsLayerProps<any> & ExtensionProps = {
//         ...ourDefaultProps,
//         ...otherProps,
//         //
//         recordBatchIdx,
//         tableOffsets,
//         id: `${id}-arrow-tripslayer-${recordBatchIdx}`,
//         data: {
//           // @ts-expect-error
//           // data: table.batches[recordBatchIdx],
//           // startIndices: pathData.data[0].valueOffsets,
//           // [重要] startIndices：告訴 GPU 「每一台車」在記憶體中的「起始頂點位置」
//           // 這已經在 updateState 算好了 (將 Float 偏移量除以 2 轉成 Vertex 偏移量)
//           startIndices: cleanIndicesArray[recordBatchIdx],
//           // length: 這個 Batch 裡面有「幾台車 (Agent)」
//           length: pathData.length,
//           attributes: {
//             // getPath 也需要剝洋蔥拿到 .values
//             // size: 2 代表告訴 GPU：「每次讀取 2 個浮點數，當作一個 [X, Y] 座標」
//             getPath: { value: pathData.data[0].children[0].values, size: 2},

//             // size: 1 代表每個座標點對應 1 個時間秒數 (Float32)
//             getTimestamps: {value: timestampData, size: 1},

//             // size: 1 代表每個座標點對應 1 個交通工具代碼 (Uint8)
//             getMode: {value: modesData, size: 1}
//           },
//         },
//         extensions: [new ModeObjectPropsExtension()],
//         filterBitMask: filterBitMask,
//         filterEnabled: true,
//         colorMap: colorMap,
//         currentTime: currentTime,
//       }

//       // --- 處理其他的 Accessor (顏色、大小等) ---
//       for(const [propName, propInput] of Object.entries(accessors)) {
//         assignAccessor({
//           props,
//           propName,
//           propInput,
//           chunkIdx: recordBatchIdx,
//           batchOffset
//         })
//       }

//       const layer = new TripsLayer({
//         ...this.getSubLayerProps(props),
//       })
      
//       layers.push(layer)
//     }
//     return layers
//   }
// }

// import {
//   CompositeLayer,
//   CompositeLayerProps,
//   DefaultProps,
//   GetPickingInfoParams,
//   Layer,
//   LayersList
// } from '@deck.gl/core';
// import { TripsLayer, TripsLayerProps } from '@deck.gl/geo-layers';
// import * as arrow from 'apache-arrow';
// import { ArrowPickingInfo, ExtensionProps } from '../types';
// import { ArrowExtraPickingProps, computeChunkOffsets, getPickingInfo } from '../utils/picking';
// import { assignAccessor, extractAccessorsFromProps } from '../utils/utils';
// import { ModeObjectPropsExtension } from './utils/extensions'; // 你的自定義 extension

// export type ArrowTripsLayerProps = Omit<
//   TripsLayerProps<arrow.Table>,
//   'data' | 'getPath' | 'getTimestamps' | 'getColor' 
// > &
//   _ArrowTripsLayerProps &
//   CompositeLayerProps;

// type _ArrowTripsLayerProps = {
//   data: arrow.Table;
//   _validate?: boolean;
//   getPathColumn?: string;
//   getTimestampColumn?: string;
//   getModeColumn?: string;
//   filterBitMask: number[];
//   filterEnabled?: boolean;
//   colorMap?: number[];
// };

// const defaultProps: DefaultProps<ArrowTripsLayerProps> = {
//   getPathColumn: 'paths',
//   getTimestampColumn: 'timestamps',
//   getModeColumn: 'modes',
//   _validate: true,
//   // 這些是 TripsLayer 特有的
//   currentTime: 0,
//   trailLength: 120, 
//   filterBitMask: [31], // 預設全開
//   filterEnabled: true
// };

// export class ArrowTripsLayer<ExtraProps extends object = object> extends CompositeLayer<
//   ArrowTripsLayerProps & ExtraProps
// > {
//   static defaultProps = defaultProps;
//   static layerName = 'ArrowTripsLayer';

//   getPickingInfo(
//     params: GetPickingInfoParams & {
//       sourceLayer: { props: ArrowExtraPickingProps };
//     }
//   ): ArrowPickingInfo {
//     return getPickingInfo(params, this.props.data);
//   }

//   renderLayers(): Layer | null | LayersList {
//     const { data: table } = this.props;
//     if (!table || !table.batches || table.batches.length === 0) return null;
//     return this._renderLayersPaths(table);
//   }

//   _renderLayersPaths(table: arrow.Table): Layer<object> | LayersList | null {
//     const {
//       id,
//       currentTime, // 從 props 傳入，不要自己加 offset
//       getPathColumn,
//       getModeColumn,
//       getTimestampColumn,
//       filterBitMask,
//       filterEnabled,
//       colorMap
//     } = this.props;

//     const [accessors, otherProps] = extractAccessorsFromProps(this.props, ['getTimestamps', 'getPath']);
//     const tableOffsets = computeChunkOffsets(table.data);
//     const layers: Layer<any>[] = [];

//     for (let i = 0; i < table.batches.length; i++) {
//       const batch = table.batches[i];

//       // 1. 取得欄位
//       const pathVector = batch.getChild(getPathColumn!);
//       const timestampVector = batch.getChild(getTimestampColumn!);
//       const modeVector = batch.getChild(getModeColumn!);

//       if (!pathVector || !timestampVector || !modeVector) {
//         console.warn(`[ArrowTripsLayer] Batch ${i} 缺少必要欄位`);
//         continue;
//       }

//       // =========================================================
//       // 🔥 核心修正：幾何對齊與正規化 (同 ArrowPathLayer)
//       // =========================================================
      
//       const srcOffsets = pathVector.data[0].valueOffsets;
//       const srcCoords = pathVector.data[0].children[0].values;
//       const numPaths = pathVector.length;

//       const baseOffset = Number(srcOffsets[0]);
//       const endOffset = Number(srcOffsets[srcOffsets.length - 1]);

//       // A. 重建 Offsets (startIndices)
//       // 邏輯：(原始Offset - 基準Offset) / 2
//       const cleanStartIndices = new Uint32Array(numPaths + 1);
//       for (let k = 0; k < srcOffsets.length; k++) {
//         cleanStartIndices[k] = (Number(srcOffsets[k]) - baseOffset) / 2;
//       }

//       // B. 建立座標視圖 (Coordinates View)
//       const srcCoordsTyped = srcCoords as Float32Array;
//       const pathView = srcCoordsTyped.subarray(baseOffset, endOffset);

//       // C. 建立屬性視圖 (Attributes View)
//       // Timestamps 和 Modes 是 Per-Vertex 的，必須跟著座標一起切
//       const attrBase = baseOffset / 2;
//       const attrEnd = endOffset / 2;

//       // 取得原始數據並切片
//       const rawTs = timestampVector.data[0].children[0].values as Float32Array;
//       const tsView = rawTs.subarray(attrBase, attrEnd);

//       const rawModes = modeVector.data[0].children[0].values as Uint8Array; // 或 Float32Array
//       const modeView = rawModes.subarray(attrBase, attrEnd);

//       // @ts-ignore
//       const batchOffset = pathVector._offsets ? pathVector._offsets[i] : 0;

//       const layerProps: any = {
//         ...otherProps, // 繼承 opacity, trailLength 等
//         id: `${id}-batch-${i}`,
//         recordBatchIdx: i,
//         tableOffsets: tableOffsets,

//         data: {
//           length: numPaths,
//           startIndices: cleanStartIndices, // 修正後的 Index
//           attributes: {
//             getPath: { value: pathView, size: 2 }, // 修正後的 View
//             getTimestamps: { value: tsView, size: 1 }, // 修正後的 View
            
//             // 你的 Extension 需要這個 attribute 嗎？
//             // 如果 ModeObjectPropsExtension 讀取的是 getMode，那就設這個
//             getMode: { value: modeView, size: 1 } 
//           }
//         },

//         // Extensions 與特殊參數
//         extensions: [new ModeObjectPropsExtension()],
//         filterBitMask: filterBitMask,
//         filterEnabled: filterEnabled,
//         colorMap: colorMap,
        
//         // 時間控制 (讓上層決定，不要在這裡加 magic number)
//         currentTime: currentTime, 
        
//         // 視覺設定
//         _pathType: 'open',
//         widthMinPixels: 2, // 確保看得到
//       };

//       for (const [propName, propInput] of Object.entries(accessors)) {
//         assignAccessor({
//           props: layerProps,
//           propName,
//           propInput,
//           chunkIdx: i,
//           batchOffset
//         });
//       }

//       layers.push(new TripsLayer(layerProps));
//     }
//     return layers;
//   }
// }
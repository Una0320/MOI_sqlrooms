/** TODO:
 * 按照修改: https://github.com/keplergl/kepler.gl/blob/ed0db73799fde6e887a4d6009fbd6695b2f6a3f6/src/deckgl-arrow-layers/src/layers/geo-arrow-arc-layer.ts
 * 
 * 
 */


import { AGENT_MODE_TRIP_COLORS } from '@/constants';
import {
  CompositeLayer,
  CompositeLayerProps,
  DefaultProps,
  Layer,
  LayersList
} from '@deck.gl/core';
import { DataFilterExtension } from '@deck.gl/extensions';
import { ArcLayer, ArcLayerProps } from "@deck.gl/layers";
import * as arrow from 'apache-arrow';
import { computeChunkOffsets } from '../utils/picking';
import { assignAccessor, extractAccessorsFromProps } from '../utils/utils';

export type ArrowODArcLayerProps = Omit<
  ArcLayerProps<arrow.Table>,
  'data'
> &
_ArrowODArcLayerProps & 
CompositeLayerProps;

/** Properties added by ArrowScatterplotLayer */
type _ArrowODArcLayerProps = {
  data: arrow.Table;
  sourceTownCodes?: Int32Array[];
  targetTownCodes?: Int32Array[];
  townFilterMask?: Uint8Array[];
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
  /**
   * @default [0,24*60*60*1000]
   */
  timeRange: [number, number]
  /**
   * @default [1,2,4,8,16]
   */
  filterMode: number[],
};

// Remove data and getPosition from the upstream default props
const {
  data: _data,
  ..._upstreamDefaultProps
} = ArcLayer.defaultProps;

// Default props added by us
const ourDefaultProps = {
  // _validate: true,
  // _pathType: 'open',
  getPathColumn: 'paths',
  getTimestampColumn: 'timestamps',
  getModeColumn: 'modes',
  timeRange: [0, 12000],
  filterMode: [2],
};

// @ts-expect-error
const defaultProps: DefaultProps<ArrowODArcLayerProps> = {
  ..._upstreamDefaultProps,
  ...ourDefaultProps
};

const mergeExtensions = (extensions: ArcLayerProps<any>['extensions']) => {
  const dataFilterExtension = new DataFilterExtension({filterSize: 1, categorySize: 1});

  if (!extensions?.length) {
    return [dataFilterExtension];
  }

  return [...extensions, dataFilterExtension];
};

export class ArrowODArcLayer<ExtraProps extends object = object> extends CompositeLayer<
  ArrowODArcLayerProps & ExtraProps
> {
  static defaultProps = defaultProps;
  static layerName = 'ArrowODArcLayer';



  renderLayers(): Layer<object> | LayersList | null {
    const { data: table } = this.props

    // @ts-ignore
    if(!table || table?.length === 0) return null;
    return this._renderLayersODArcLayer(table)
  }

  _renderLayersODArcLayer(
    table: arrow.Table
  ): Layer<object> | LayersList | null {
    const {
      id,
      getPathColumn,
      getModeColumn,
      getTimestampColumn,
      townFilterMask,
      timeRange,
      filterMode
    } = this.props
    // 如果上層有傳入的話
    const [accessors, otherProps] = extractAccessorsFromProps(this.props, [])

    // 計算整個 table (所有 batch) 的累計偏移量，主要用於 picking
    const tableOffsets = computeChunkOffsets(table.data)
    const layers: ArcLayer<any>[] = []

    for(let recordBatchIdx=0; recordBatchIdx<table.batches.length; recordBatchIdx++){
      const pathData = table.batches[recordBatchIdx].getChild(getPathColumn)
      const timestampData = table.batches[recordBatchIdx].getChild(getTimestampColumn)
      const modesData = table.batches[recordBatchIdx].getChild(getModeColumn)
      const batchTownFilterMask = townFilterMask?.[recordBatchIdx]
      
      // @ts-expect-error
      const batchOffset = pathData._offsets[recordBatchIdx]
      // const pathValues = pathData.data[0].children[0].values
      // const timestampValues = timestampData.data[0].children[0].values
      // const modeValues = modesData.data[0].children[0].values
      // --- 修正後的寫法 ---
      // path 依然是長度為 4 的 List，所以保留 children[0]
      const pathValues = pathData.data[0].children[0].values; 

      // timestamp 和 mode 現在是純數字陣列了，直接讀取 values！
      const timestampValues = timestampData.data[0].values; 
      const modeValues = modesData.data[0].values;
      const filteredPathValues = filterValuesByMask(pathValues, 4, batchTownFilterMask)
      const filteredTimestampValues = filterValuesByMask(timestampValues, 1, batchTownFilterMask)
      const filteredModeValues = filterValuesByMask(modeValues, 1, batchTownFilterMask)
      const filteredLength = batchTownFilterMask
        ? batchTownFilterMask.reduce((sum, value) => sum + value, 0)
        : pathData.length

      if (filteredLength === 0) {
        continue
      }

      const props: ArcLayerProps<any> = {
        ...ourDefaultProps,
        ...otherProps,
        tableOffsets,
        id: `${id}-od-arc-layer-${recordBatchIdx}`,
        data: {
          length: filteredLength,
          attributes: {
            /*
              ===================================================================
              [WebGL 記憶體切片 (Interleaved Memory) 設定說明]
              
              我們傳入的 filteredPathValues 是一個扁平的 Float32Array 陣列。
              它的資料排列方式是每 4 個數字組成一條 Arc (飛線)：
              [ 來源X, 來源Y, 目的地X, 目的地Y, 來源X2, 來源Y2, 目的地X2, 目的地Y2 ... ]
              
              在 WebGL / Deck.gl 中，stride (跨步) 和 offset (偏移量) 的單位是「Bytes (位元組)」，
              而不是陣列的「元素個數 (Index)」。

              【數學計算】：
              1. 陣列型別為 Float32 (32-bit 浮點數)，每個數字佔用 4 Bytes。
              2. 每一條 Arc 包含 4 個數字 (SX, SY, EX, EY)。
              3. 一條 Arc 的總資料長度 = 4 數字 * 4 Bytes = 16 Bytes。
              
              【參數設定】：
              - stride: 16 (告訴 GPU，讀完當前的頂點後，要往後跳過 16 Bytes 才能找到下一條 Arc 的資料)
              - getSourcePosition offset: 0 (來源座標從這 16 Bytes 的最開頭讀取)
              - getTargetPosition offset: 8 (目的地座標必須跳過前面的 SX, SY (2 數字 * 4 Bytes = 8 Bytes) 開始讀取)
              ===================================================================
            */
            getSourcePosition: {value: filteredPathValues, size: 2, stride: 16, offset: 0},
            getTargetPosition: {value: filteredPathValues, size: 2, stride: 16, offset: 8},
            getMode: {value: filteredModeValues, size: 1},
            getColorCode: filteredModeValues,
            getFilterValue: filteredTimestampValues,
            getFilterCategory: filteredModeValues,
          },
        },
        // @ts-ignore
        getSourceColor: ((_, item) => {
          // @ts-ignore
          return AGENT_MODE_TRIP_COLORS[Math.log2(item.data.attributes.getColorCode[item.index])]
        }),
        // @ts-ignore
        getTargetColor: ((_, item) =>{
          // @ts-ignore
          return AGENT_MODE_TRIP_COLORS[Math.log2(item.data.attributes.getColorCode[item.index])]
        }),
        extensions: mergeExtensions(otherProps.extensions),
        filterRange: timeRange,
        filterCategories: filterMode,
        getWidth: 2,
        getHeight: 1,
      }

      // --- 處理其他的 Accessor (顏色、大小等) ---
      for(const [propName, propInput] of Object.entries(accessors)) {
        assignAccessor({
          props,
          propName,
          propInput,
          chunkIdx: recordBatchIdx,
          batchOffset
        })
      }

      const layer = new ArcLayer({
        ...this.getSubLayerProps(props)
      })

      layers.push(layer)
    }
    return layers
  }


}

const filterValuesByMask = <T extends ArrayLike<number>>(
  values: T,
  rowWidth: number,
  mask?: Uint8Array
) => {
  if (!mask) {
    return values
  }

  const keptCount = mask.reduce((sum, value) => sum + value, 0)
  const TypedArray = values.constructor as {
    new(length: number): T
  }
  const filteredValues = new TypedArray(keptCount * rowWidth)
  let nextIndex = 0

  for (let row = 0; row < mask.length; row++) {
    if (!mask[row]) {
      continue
    }

    for (let column = 0; column < rowWidth; column++) {
      // @ts-expect-error typed array assignment
      filteredValues[nextIndex++] = values[row * rowWidth + column]
    }
  }

  return filteredValues
}

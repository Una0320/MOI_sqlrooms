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
import { ArrowPickingInfo } from '../types';
import { ArrowExtraPickingProps, getPickingInfo } from '../utils/picking';
import { extractAccessorsFromProps } from '../utils/utils';
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

    const [, otherProps] = extractAccessorsFromProps(this.props, ['getTimestamps', 'getPath']);
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

import { LayerExtension } from '@deck.gl/core';
import { ModeObjectProps, modeObjectUniforms } from './mode-shader-module';
import { DataFilterExtension } from '@deck.gl/extensions';

// TODO: 完成 ModeObjectPropsExtension 的註解說明
export type ModeExtensionProps = {
  /** * Accessor: 回傳資料的類別 ID (必須是 0 ~ 31 的整數) 
   */
  getMode?: (d: any) => number;
  
  /** * 要顯示的類別 ID 陣列 
   */
  filterBitMask?: number[];
  
  /** * 全域開關 
   */
  filterEnabled?: boolean;
  /**
   */
  colorMap?: number[]
};

const defaultProps = {
  getBitMask: { type: 'accessor', value: 0 },
  filterBitMask: { type: 'number', value: 0xFFFFFFFF, min: 0 },
  filterEnabled: true,
  colorMap: { type: 'array', value: []}
};


export class ModeObjectPropsExtension extends LayerExtension {
  static defaultProps = defaultProps;
  static extensionName = 'ModeObjectExtension';

  constructor() {
    super();
  }

  getShaders() {
    return {
      modules: [modeObjectUniforms]
    };
  }

  initializeState(this, context, extension) {
    const attributeManager = this.getAttributeManager();
    
    if (attributeManager) {
      // 只新增這一個 Attribute，解決 "Too many attributes" 問題
      attributeManager.add({
        mode_type: {
          size: 1,
          // type: 'uint32',
          accessor: 'getMode',
          stepMode: "dynamic",
          shaderAttributes: {
            mode_type: {
              divisor: 1,
            }
          }
        }
      });
    }
  }


  draw(this, params, extension) {
    const { 
      filterBitMask = [], 
      filterEnabled = true, 
      colorMap = [],
    } = this.props;
    // 計算 Bitmask
    // 如果 filterEnabled 為 false，傳入 0xFFFFFFFF (所有位元為1) 讓所有東西都顯示
    let mask = 0;

    if (!filterEnabled) {
      mask = 0xffffffff; 
    } else {
      for (const category of filterBitMask) {
        // 確保類別在 0-31 安全範圍內
        if (typeof category === 'number' && category >= 0 && category < 32) {
          // 這裡我們假設 filterBitMask 傳入的是已經計算好的 bitmask 值，例如 16 (2^4)
          // 如果是傳入類別 ID (例如 4)，則應該用 mask |= (1 << category)
          mask |= category;
        }
      }
    }
    
    const modeObjectProps: ModeObjectProps = {
      bitmask: mask,
      colorMap: colorMap,
    }

    for(const model of this.getModels()){
      
      model.shaderInputs.setProps({
        // modeObjectProps 要跟 cv 中 uniform物件 的 name 一樣 
        modeObject: modeObjectProps,
      })
    }
  }
}


export class HeatmapDataFilterExtension extends DataFilterExtension {
  constructor(props: any) {
    super(props);
  }

  // 🔥 核心修正：覆寫 ID 映射邏輯
  // 原本會回傳 map[category] (動態索引)，我們強迫它直接回傳 category (固定索引)
  _getCategoryKey(category: number) {
    return category;
  }
}
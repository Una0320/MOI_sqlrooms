import { useMemo } from 'react';
import * as arrow from 'apache-arrow';
import { useShallow } from '@sqlrooms/room-shell';

import { ArrowPathLayer } from '../components/custom_layer/arrowPathLayer/ArrowPathLayer';
import { AGENT_MODE_TRIP_COLORS } from '../constants/map';
import { LAYER_IDS } from '../constants/layers';
import { useMapStore } from '../zustand/useMapStore';

// ============================================================================
//  資料來源策略
// ----------------------------------------------------------------------------
//  目前 heatmap 與 trips 共用同一份 arrowTable(由 MainView 經由 useSql 拉到後
//  以 prop 傳進來),不再打第二次 DuckDB。
//
//  TODO(未來情境分流):若 heatmap 改用不同 parquet/SQL,把這個 hook 改為內部自
//  己 useSql({ query: '...' }) 取資料,並把 arrowTable 參數移除。介面對外仍然
//  只回傳 Layer[],呼叫方(MapView)不會受影響。
// ============================================================================

export const useHeatmapLayer = (arrowTable: arrow.Table | undefined) => {
  const { selectedModes, timeRange, visible } = useMapStore(
    useShallow((s) => ({
      selectedModes: s.selectedModes,
      timeRange: s.timeRange,
      visible: s.visibleLayers[LAYER_IDS.HEATMAP] ?? false,
    })),
  );

  // 用字串 key 當 useMemo 依賴,避免 array reference 變動造成不必要的重建。
  const timeRangeKey = `${timeRange[0]}-${timeRange[1]}`;
  const selectedModesKey = selectedModes.join(',');

  return useMemo(() => {
    if (!arrowTable || !visible) return [];

    // 為每個被勾選的 mode 各建一個 ArrowPathLayer 子層,讓每個運具能擁有自己
    // 的顏色與 GPU filter。同一份 arrowTable 被多個子層共用(zero-copy)。
    return selectedModes.map((modeBitmask) => {
      const modeIndex = Math.floor(Math.log2(modeBitmask));
      const base = AGENT_MODE_TRIP_COLORS[modeIndex] ?? [255, 255, 255, 150];
      // 強制 alpha=150,讓多條線疊加產生熱力感(配合下方的加法混合)
      const color = new Uint8Array([base[0], base[1], base[2], 150]);

      return new ArrowPathLayer({
        id: `${LAYER_IDS.HEATMAP}-mode-${modeBitmask}`,
        data: arrowTable,
        getPathColumn: 'paths',
        getTimestampColumn: 'timestamps',
        getModeColumn: 'modes',

        getColor: color,
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 2,

        // GPU 過濾:時間範圍 + 單一 mode
        timeRange,
        filterCategories: [modeBitmask],

        parameters: {
          depthTest: false,
          blend: true,
          blendColorSrcFactor: 'src-alpha',
          blendColorDstFactor: 'one', // additive blend → 熱力疊加效果
          blendColorOperation: 'add',
        },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrowTable, visible, timeRangeKey, selectedModesKey]);
};

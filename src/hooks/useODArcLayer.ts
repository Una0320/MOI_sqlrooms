import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { useResolvedFiles } from './useResolvedFiles';
import { ArrowODArcLayer } from '@/components/custom_layer/arrowODArcLayer/ArrowODArcLayer';

export const useODArcLayer = () => {
  const { timeRange, selectedModes, odVisible } = useMapStore(
    useShallow((state) => ({
      timeRange: state.timeRange,
      selectedModes: state.selectedModes,
      odVisible: state.visibleLayers[LAYER_IDS.OD_ARC] ?? false,
    }))
  );

  const { odDataUrl } = useResolvedFiles();
  // 沒有 OD 檔（null）就查一個零列的 SQL，下面 useMemo 會因為沒有資料而不建圖層
  const query = odDataUrl ? `SELECT * FROM read_parquet('${odDataUrl}')` : 'SELECT 1 WHERE false';

  const { data: queryResult } = useSql<Record<string, unknown>>({ query });
  const arrowTable = queryResult?.arrowTable;

  return useMemo(() => {
    if (!odDataUrl || !arrowTable || !odVisible) return null;

    return new ArrowODArcLayer({
      id: 'od-arc-layer',
      data: arrowTable,
      visible: true,
      widthMinPixels: 2,
      timeRange: timeRange as [number, number],
      filterMode: selectedModes,
    });
  }, [odDataUrl, arrowTable, odVisible, timeRange, selectedModes]);
};

import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { SCENARIO_CONFIG } from '@/constants/data';
import { ArrowODArcLayer } from '@/components/custom_layer/arrowODArcLayer/ArrowODArcLayer';

export const useODArcLayer = () => {
  const { timeRange, selectedModes, odVisible, scenarioType } = useMapStore(
    useShallow((state) => ({
      timeRange: state.timeRange,
      selectedModes: state.selectedModes,
      odVisible: state.visibleLayers[LAYER_IDS.OD_ARC] ?? false,
      scenarioType: state.scenarioType,
    }))
  );

  const odDataUrl = SCENARIO_CONFIG[scenarioType].odDataUrl;
  const query = `SELECT * FROM read_parquet('${odDataUrl}')`;

  const { data: queryResult } = useSql<Record<string, unknown>>({ query });
  const arrowTable = queryResult?.arrowTable;

  return useMemo(() => {
    if (!arrowTable || !odVisible) return null;

    return new ArrowODArcLayer({
      id: 'od-arc-layer',
      data: arrowTable,
      visible: true,
      widthMinPixels: 2,
      timeRange: timeRange as [number, number],
      filterMode: selectedModes,
    });
  }, [arrowTable, odVisible, timeRange, selectedModes]);
};

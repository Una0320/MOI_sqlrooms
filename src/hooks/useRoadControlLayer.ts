import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { PathLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { ROAD_CONTROL_COLORS, type RoadControlMeasure } from '@/constants/roadService';
import { useResolvedFiles } from './useResolvedFiles';

type ControlLink = { path: Float32Array; measure: RoadControlMeasure; start: number; end: number };

// 沒有 roadControlUrl（沒開路網管制）或圖層沒打開：查一個保證 0 列的 SQL
const buildQuery = (url: string | null) =>
  url
    ? `SELECT paths, measure, start_s, end_s FROM read_parquet('${url}')`
    : `SELECT NULL AS paths, NULL AS measure, NULL AS start_s, NULL AS end_s WHERE FALSE`;

// 道路管制：封路 / 禁小客車 / 公車專用道，依 start_s <= t < end_s 顯示
// （整場封閉的 start_s 是負的，所以一開始就在）。約 1.2 萬條，一次載入、每次時間變動只重新過濾。
export const useRoadControlLayer = () => {
  const { time, visible } = useMapStore(
    useShallow((s) => ({
    time: s.time,
    visible: s.visibleLayers[LAYER_IDS.ROAD_CONTROL] ?? false,
  })),
  );
  const { roadControlUrl } = useResolvedFiles();
  const { data } = useSql<Record<string, unknown>>({ query: buildQuery(visible ? roadControlUrl : null) });
  const arrowTable = data?.arrowTable;

  const links = useMemo<ControlLink[]>(() => {
    if (!arrowTable || arrowTable.numRows === 0) return [];
    const pathsCol = arrowTable.getChild('paths');
    const measureCol = arrowTable.getChild('measure');
    const startCol = arrowTable.getChild('start_s');
    const endCol = arrowTable.getChild('end_s');
    if (!pathsCol || !measureCol || !startCol || !endCol) return [];
    const out: ControlLink[] = [];
    for (let i = 0; i < arrowTable.numRows; i++) {
      out.push({
        path: (pathsCol.get(i) as { toArray(): Float32Array }).toArray(),
        measure: String(measureCol.get(i)) as RoadControlMeasure,
        start: Number(startCol.get(i)),
        end: Number(endCol.get(i)),
      });
    }
    return out;
  }, [arrowTable]);

  // 只在「現在生效的集合」變動時才換 data（用 start/end 判斷，不是每個 frame 都重建）
  const active = useMemo(() => links.filter((l) => l.start <= time && time < l.end), [links, time]);

  return useMemo(() => {
    if (!visible || active.length === 0) return null;
    return new PathLayer<ControlLink>({
      id: 'road-control-layer',
      data: active,
      positionFormat: 'XY',
      getPath: (d) => d.path as unknown as number[],
      getColor: (d) => ROAD_CONTROL_COLORS[d.measure] ?? [255, 255, 255, 200],
      getWidth: 3,
      widthUnits: 'pixels',
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
      pickable: false,
    });
  }, [visible, active]);
};

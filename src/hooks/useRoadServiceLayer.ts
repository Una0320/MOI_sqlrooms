import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { PathLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { useResolvedFiles } from './useResolvedFiles';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/constants/map';
import {
  ROAD_LEVEL_COLORS,
  ROAD_WIDTH_MAX_PX,
  ROAD_WIDTH_MIN_PX,
  roadWidthPx,
  roadWidthScaleForZoom,
  type RoadLevel,
} from '@/constants/roadService';

type RoadLink = {
  path: Float32Array; // 扁平 [lon, lat, ...]，配合 positionFormat: 'XY'
  level: RoadLevel;
  width: number; // px
};
type HourBucket = { start: number; end: number; links: RoadLink[] };

// 圖層沒打開 / 這個組合沒有檔案：查一個保證 0 列的 SQL（所以只在圖層第一次打開時才下載這份 parquet）
const buildQuery = (url: string | null) =>
  url
    ? `SELECT paths, hour_start, hour_end, level FROM read_parquet('${url}')`
    : `SELECT NULL AS paths, NULL AS hour_start, NULL AS hour_end, NULL AS level WHERE FALSE`;

export const useRoadServiceLayer = (currentZoom: number) => {
  const { time, visible } = useMapStore(
    useShallow((s) => ({
    time: s.time,
    visible: s.visibleLayers[LAYER_IDS.ROAD_SERVICE] ?? false,
  })),
  );
  const { roadServiceUrl } = useResolvedFiles();
  const { data } = useSql<Record<string, unknown>>({ query: buildQuery(visible ? roadServiceUrl : null) });
  const arrowTable = data?.arrowTable;

  // 一次把整張表依「小時」分桶，並由順到塞排序（塞的路段最後畫，不會被大量順暢細線蓋住）
  const buckets = useMemo<HourBucket[]>(() => {
    if (!arrowTable || arrowTable.numRows === 0) return [];
    const pathsCol = arrowTable.getChild('paths');
    const startCol = arrowTable.getChild('hour_start');
    const endCol = arrowTable.getChild('hour_end');
    const levelCol = arrowTable.getChild('level');
    if (!pathsCol || !startCol || !endCol || !levelCol) return [];

    const byHour = new Map<number, HourBucket>();
    for (let i = 0; i < arrowTable.numRows; i++) {
      const start = Number(startCol.get(i));
      let bucket = byHour.get(start);
      if (!bucket) {
        bucket = { start, end: Number(endCol.get(i)), links: [] };
        byHour.set(start, bucket);
      }
      const level = Number(levelCol.get(i)) as RoadLevel;
      bucket.links.push({
        path: (pathsCol.get(i) as { toArray(): Float32Array }).toArray(),
        level,
        width: roadWidthPx(level),
      });
    }
    const list = [...byHour.values()].sort((a, b) => a.start - b.start);
    for (const b of list) b.links.sort((x, y) => x.level - y.level);
    return list;
  }, [arrowTable]);

  // 依目前時間取 hour_start <= t < hour_end 的那一小時（時間超出資料範圍就不畫）
  const bucket = useMemo(() => buckets.find((b) => b.start <= time && time < b.end) ?? null, [buckets, time]);

  // zoom 只改 widthScale（不需要重算 path）
  const widthScale = roadWidthScaleForZoom(currentZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);

  return useMemo(() => {
    if (!visible || !bucket) return null;
    return new PathLayer<RoadLink>({
      id: 'road-service-layer',
      data: bucket.links,
      positionFormat: 'XY',
      getPath: (d) => d.path as unknown as number[],
      getColor: (d) => ROAD_LEVEL_COLORS[d.level] ?? ROAD_LEVEL_COLORS[1],
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      widthScale,
      widthMinPixels: ROAD_WIDTH_MIN_PX,
      widthMaxPixels: ROAD_WIDTH_MAX_PX * 1.6,
      capRounded: true,
      jointRounded: true,
      pickable: false,
    });
  }, [visible, bucket, widthScale]);
};

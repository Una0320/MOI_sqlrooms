import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import Supercluster from 'supercluster';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { AGENT_MODE_TRIP_COLORS, MAP_MAX_ZOOM } from '@/constants/map';
import { SCENARIO_CONFIG, BUS_STOPS_URL, METRO_STATIONS_URL } from '@/constants/data';

const SCATTER_LAYER_ID = 'stop-counts-layer';
const TEXT_LAYER_ID = 'stop-counts-labels';
const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];
// 聚合強度的兩個旋鈕：
// - CLUSTER_MAX_ZOOM：supercluster 的分群只算到這一層為止；查詢 zoom 只要「超過」這個值
//   （也就是 maxZoom + 1 以上）才會拿到完全展開、未分群的原始點——查詢 zoom 剛好等於這個值
//   仍然是已分群的結果。所以要設得比地圖實際最大 zoom（MAP_MAX_ZOOM）少 1，
//   放大到底時查詢才會真的超過上限、觸發完全展開，不然 zoom 到頂還是會看到泡泡。
// - CLUSTER_RADIUS：聚合半徑（螢幕像素），數字越大同一個 zoom 下越容易合併成大泡泡。
const CLUSTER_MAX_ZOOM = MAP_MAX_ZOOM - 1;
const CLUSTER_RADIUS = 25;

// 沒有 stopCountsUrl（情境用不到這張表，例如 shelter_in_place）就查一個保證 0 列的 SQL，圖層自然生不出東西
const buildQuery = (stopCountsUrl: string | null) =>
  stopCountsUrl
    ? `
    SELECT
      COALESCE(sc.stop_id, sc.station_id) AS entity_id,
      sc.mode,
      sc.timestamps,
      sc.waiting,
      COALESCE(bs.X, ms.X) AS X,
      COALESCE(bs.Y, ms.Y) AS Y
    FROM read_parquet('${stopCountsUrl}') sc
    LEFT JOIN read_csv_auto('${BUS_STOPS_URL}') bs ON sc.mode = 8 AND sc.stop_id = bs.stop_id
    LEFT JOIN read_csv_auto('${METRO_STATIONS_URL}') ms ON sc.mode = 16 AND sc.station_id = ms.station_id
    WHERE COALESCE(bs.X, ms.X) IS NOT NULL
    ORDER BY entity_id, sc.timestamps
  `
    : `SELECT NULL AS entity_id, NULL AS mode, NULL AS timestamps, NULL AS waiting, NULL AS X, NULL AS Y WHERE FALSE`;

type StopEntity = { x: number; y: number; mode: number; timestamps: number[]; waiting: number[] };
type StationLocation = { x: number; y: number; mode: number; members: StopEntity[] };
type RenderGroup = { x: number; y: number; mode: number; members: StationLocation[] };
type StopSnapshot = { x: number; y: number; mode: number; waiting: number; radius: number };

// bus_stops.csv 是「每條路線各自一個 stop_id」，同一根站牌常常被多條路線共用、座標完全一樣
// （實測 pt10 有 45% 的站牌座標被 2～16 個 stop_id 共用）。用 stop_id 個別畫點會在同一個
// 物理站牌疊出好幾個大小不一的圓圈。改成用座標＋運具分組，同一物理站牌的候車人數在當下時間點加總，
// 只畫一個圓圈、一個數字，代表這個站牌當下的總候車人潮。
const LOCATION_PRECISION = 6; // 小數 6 位（約 0.1 公尺），足以合併同座標、不會誤併鄰近但不同的站牌
const locationKey = (x: number, y: number, mode: number) => `${x.toFixed(LOCATION_PRECISION)}_${y.toFixed(LOCATION_PRECISION)}_${mode}`;

// 找出 <= time 的最後一格（站點候車人數是離散的時間格快照，不是連續插值）
const findCurrentIndex = (timestamps: number[], time: number): number => {
  let lo = 0;
  let hi = timestamps.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
};

export const useStopCountsLayer = (currentZoom: number) => {
  const { time, visible, scenarioType } = useMapStore(
    useShallow((s) => ({
      time: s.time,
      visible: s.visibleLayers[LAYER_IDS.STOP_COUNTS] ?? false,
      scenarioType: s.scenarioType,
    }))
  );

  const query = buildQuery(SCENARIO_CONFIG[scenarioType].stopCountsUrl);
  const { data } = useSql<Record<string, unknown>>({ query });
  const arrowTable = data?.arrowTable;

  // 第一階段（只在資料來源變動時重算）：座標不會動，先把同一物理站牌的 stop_id 分組，
  // 再依運具各自建一個 supercluster 空間索引（bus/metro 不互相合併，顏色才有意義）。
  const indexData = useMemo(() => {
    if (!arrowTable) return null;

    const rows = arrowTable.toArray();
    const byEntity = new Map<string, StopEntity>();
    for (const row of rows as any[]) {
      if (row.entity_id == null || row.X == null || row.Y == null) continue;
      const key = `${row.entity_id}_${row.mode}`;
      let entity = byEntity.get(key);
      if (!entity) {
        entity = { x: Number(row.X), y: Number(row.Y), mode: Number(row.mode), timestamps: [], waiting: [] };
        byEntity.set(key, entity);
      }
      entity.timestamps.push(Number(row.timestamps));
      entity.waiting.push(Number(row.waiting));
    }

    const byLocation = new Map<string, StationLocation>();
    for (const entity of byEntity.values()) {
      const key = locationKey(entity.x, entity.y, entity.mode);
      let group = byLocation.get(key);
      if (!group) {
        group = { x: entity.x, y: entity.y, mode: entity.mode, members: [] };
        byLocation.set(key, group);
      }
      group.members.push(entity);
    }

    const locationsByMode = new Map<number, StationLocation[]>();
    for (const loc of byLocation.values()) {
      const arr = locationsByMode.get(loc.mode) ?? [];
      arr.push(loc);
      locationsByMode.set(loc.mode, arr);
    }

    const indexByMode = new Map<number, { locations: StationLocation[]; index: Supercluster<{ locationIndex: number }> }>();
    for (const [mode, locations] of locationsByMode) {
      const index = new Supercluster<{ locationIndex: number }>({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM });
      index.load(
        locations.map((loc, locationIndex) => ({
          type: 'Feature' as const,
          properties: { locationIndex },
          geometry: { type: 'Point' as const, coordinates: [loc.x, loc.y] },
        }))
      );
      indexByMode.set(mode, { locations, index });
    }

    return indexByMode;
  }, [arrowTable]);

  // 第二階段（只在 zoom 變動時重算）：查詢當前 zoom 下的分群結果，縮小時合併成大泡泡、
  // 放大時逐漸展開回個別站牌。查詢跑在靜態索引上，跟候車人數（會隨時間變化）完全無關。
  // ⚠ 這裡要用 MAP_MAX_ZOOM（地圖實際能到的上限）夾住，不能用 CLUSTER_MAX_ZOOM——
  // 後者比前者少 1，就是要讓查詢在地圖放到最大時「超過」它，觸發完全展開。
  const flooredZoom = Math.min(MAP_MAX_ZOOM, Math.max(0, Math.floor(currentZoom)));

  const renderGroups = useMemo(() => {
    if (!indexData) return [];
    const groups: RenderGroup[] = [];

    for (const [mode, { locations, index }] of indexData) {
      const features = index.getClusters(WORLD_BBOX, flooredZoom);
      for (const feature of features) {
        const [x, y] = feature.geometry.coordinates;
        if ('cluster' in feature.properties && feature.properties.cluster) {
          const leaves = index.getLeaves(feature.properties.cluster_id, Infinity);
          groups.push({ x, y, mode, members: leaves.map((l) => locations[l.properties.locationIndex]) });
        } else {
          groups.push({ x, y, mode, members: [locations[feature.properties.locationIndex]] });
        }
      }
    }

    return groups;
  }, [indexData, flooredZoom]);

  // 第三階段（每一幀都會跑，但很便宜）：只是把每個泡泡裡成員站牌的當下候車人數加總。
  return useMemo(() => {
    if (!visible || renderGroups.length === 0) return [];

    const snapshots: StopSnapshot[] = [];
    for (const group of renderGroups) {
      let waiting = 0;
      let hasData = false;
      for (const loc of group.members) {
        for (const member of loc.members) {
          const idx = findCurrentIndex(member.timestamps, time);
          if (idx === -1) continue;
          waiting += member.waiting[idx];
          hasData = true;
        }
      }
      if (!hasData) continue;

      snapshots.push({
        x: group.x,
        y: group.y,
        mode: group.mode,
        waiting,
        // 只用圓圈大小代表人潮多寡（sqrt 縮放），不再疊加發光
        radius: Math.min(28, 6 + Math.sqrt(Math.max(0, waiting))),
      });
    }

    if (snapshots.length === 0) return [];

    return [
      new ScatterplotLayer({
        id: SCATTER_LAYER_ID,
        data: snapshots,
        getPosition: (d: StopSnapshot) => [d.x, d.y, 0],
        getFillColor: (d: StopSnapshot) => {
          const colorIndex = Math.floor(Math.log2(d.mode));
          return AGENT_MODE_TRIP_COLORS[colorIndex] ?? [255, 255, 255, 200];
        },
        getRadius: (d: StopSnapshot) => d.radius,
        radiusUnits: 'pixels',
        radiusMinPixels: 3,
        pickable: false,
        parameters: { depthTest: false },
      } as any),
      // 圈裡直接標數字，比用圈的大小去目測精準
      new TextLayer({
        id: TEXT_LAYER_ID,
        data: snapshots,
        getPosition: (d: StopSnapshot) => [d.x, d.y, 0],
        getText: (d: StopSnapshot) => String(d.waiting),
        getSize: 10,
        getColor: [20, 20, 20, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        pickable: false,
      } as any),
    ];
  }, [visible, renderGroups, time]);
};

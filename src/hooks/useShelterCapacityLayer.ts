import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { SHELTER_STATUS_COLORS } from '@/constants/map';
import { SCENARIO_CONFIG } from '@/constants/data';

const SCATTER_LAYER_ID = 'shelter-capacity-layer';
const TEXT_LAYER_ID = 'shelter-capacity-labels';

// 沒有 shelterCapacityUrl（情境用不到這張表，例如 mass_evacuation）就查一個保證 0 列的 SQL
const buildQuery = (shelterCapacityUrl: string | null) =>
  shelterCapacityUrl
    ? `SELECT shelter_id, shelter_name, capacity, timestamps, current_count, load_ratio, status, X, Y FROM read_parquet('${shelterCapacityUrl}') ORDER BY shelter_id, timestamps`
    : `SELECT NULL AS shelter_id, NULL AS shelter_name, NULL AS capacity, NULL AS timestamps, NULL AS current_count, NULL AS load_ratio, NULL AS status, NULL AS X, NULL AS Y WHERE FALSE`;

type ShelterEntity = {
  id: string;
  name: string;
  capacity: number;
  x: number;
  y: number;
  timestamps: number[];
  currentCount: number[];
  loadRatio: number[];
  status: string[];
};
type ShelterSnapshot = {
  id: string;
  name: string;
  capacity: number;
  x: number;
  y: number;
  currentCount: number;
  loadRatio: number;
  status: string;
};

// 找出 <= time 的最後一格（避難所收容人數是離散的時間格快照，不是連續插值）
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

export const useShelterCapacityLayer = () => {
  const { time, visible, scenarioType } = useMapStore(
    useShallow((s) => ({
      time: s.time,
      visible: s.visibleLayers[LAYER_IDS.SHELTER_CAPACITY] ?? false,
      scenarioType: s.scenarioType,
    }))
  );

  const query = buildQuery(SCENARIO_CONFIG[scenarioType].shelterCapacityUrl);
  const { data } = useSql<Record<string, unknown>>({ query });
  const arrowTable = data?.arrowTable;

  return useMemo(() => {
    if (!arrowTable || !visible) return [];

    const rows = arrowTable.toArray() as any[];
    const grouped = new Map<string, ShelterEntity>();
    for (const row of rows) {
      if (row.shelter_id == null || row.X == null || row.Y == null) continue;
      let entity = grouped.get(row.shelter_id);
      if (!entity) {
        entity = {
          id: String(row.shelter_id),
          name: String(row.shelter_name ?? ''),
          capacity: Number(row.capacity),
          x: Number(row.X),
          y: Number(row.Y),
          timestamps: [],
          currentCount: [],
          loadRatio: [],
          status: [],
        };
        grouped.set(row.shelter_id, entity);
      }
      entity.timestamps.push(Number(row.timestamps));
      entity.currentCount.push(Number(row.current_count));
      entity.loadRatio.push(Number(row.load_ratio));
      entity.status.push(String(row.status));
    }

    const snapshots: ShelterSnapshot[] = [];
    for (const e of grouped.values()) {
      const idx = findCurrentIndex(e.timestamps, time);
      if (idx === -1) continue;
      snapshots.push({
        id: e.id,
        name: e.name,
        capacity: e.capacity,
        x: e.x,
        y: e.y,
        currentCount: e.currentCount[idx],
        loadRatio: e.loadRatio[idx],
        status: e.status[idx],
      });
    }

    if (snapshots.length === 0) return [];

    return [
      new ScatterplotLayer({
        id: SCATTER_LAYER_ID,
        data: snapshots,
        getPosition: (d: ShelterSnapshot) => [d.x, d.y, 0],
        getFillColor: (d: ShelterSnapshot) => SHELTER_STATUS_COLORS[d.status] ?? [200, 200, 200, 180],
        getRadius: (d: ShelterSnapshot) => Math.min(20, 6 + d.loadRatio * 8),
        radiusUnits: 'pixels',
        radiusMinPixels: 4,
        pickable: true,
        parameters: { depthTest: false },
      } as any),
      // 圈裡標 load_ratio(%)，跟圓圈大小同一個量（壅擠度），避免「大圈小數字」；
      // 絕對收容人數（current_count）改到 hover tooltip 顯示（見 MapView 的 getTooltip）
      new TextLayer({
        id: TEXT_LAYER_ID,
        data: snapshots,
        getPosition: (d: ShelterSnapshot) => [d.x, d.y, 0],
        getText: (d: ShelterSnapshot) => `${Math.round(d.loadRatio * 100)}%`,
        getSize: 10,
        getColor: [20, 20, 20, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        pickable: false,
      } as any),
    ];
  }, [arrowTable, visible, time]);
};

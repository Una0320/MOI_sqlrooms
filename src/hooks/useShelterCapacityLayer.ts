import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { SHELTER_STATUS_COLORS } from '@/constants/map';
import { SCENARIO_CONFIG } from '@/constants/data';

const LAYER_ID = 'shelter-capacity-layer';

// 沒有 shelterCapacityUrl（情境用不到這張表，例如 mass_evacuation）就查一個保證 0 列的 SQL
const buildQuery = (shelterCapacityUrl: string | null) =>
  shelterCapacityUrl
    ? `SELECT shelter_id, timestamps, load_ratio, status, X, Y FROM read_parquet('${shelterCapacityUrl}') ORDER BY shelter_id, timestamps`
    : `SELECT NULL AS shelter_id, NULL AS timestamps, NULL AS load_ratio, NULL AS status, NULL AS X, NULL AS Y WHERE FALSE`;

type ShelterEntity = { x: number; y: number; timestamps: number[]; loadRatio: number[]; status: string[] };
type ShelterSnapshot = { x: number; y: number; loadRatio: number; status: string };

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
        entity = { x: Number(row.X), y: Number(row.Y), timestamps: [], loadRatio: [], status: [] };
        grouped.set(row.shelter_id, entity);
      }
      entity.timestamps.push(Number(row.timestamps));
      entity.loadRatio.push(Number(row.load_ratio));
      entity.status.push(String(row.status));
    }

    const snapshots: ShelterSnapshot[] = [];
    for (const e of grouped.values()) {
      const idx = findCurrentIndex(e.timestamps, time);
      if (idx === -1) continue;
      snapshots.push({ x: e.x, y: e.y, loadRatio: e.loadRatio[idx], status: e.status[idx] });
    }

    if (snapshots.length === 0) return [];

    return [
      new ScatterplotLayer({
        id: LAYER_ID,
        data: snapshots,
        getPosition: (d: ShelterSnapshot) => [d.x, d.y, 0],
        getFillColor: (d: ShelterSnapshot) => SHELTER_STATUS_COLORS[d.status] ?? [200, 200, 200, 180],
        getRadius: (d: ShelterSnapshot) => Math.min(20, 6 + d.loadRatio * 8),
        radiusUnits: 'pixels',
        radiusMinPixels: 4,
        pickable: false,
        parameters: { depthTest: false },
      } as any),
    ];
  }, [arrowTable, visible, time]);
};

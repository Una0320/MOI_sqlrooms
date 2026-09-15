import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { FACILITY_STATION_COLOR, FACILITY_SHELTER_COLOR } from '@/constants/map';
import { BUS_STOPS_URL, METRO_STATIONS_URL, SHELTERS_URL } from '@/constants/data';

type StationPoint = { id: string; name: string; kind: 'bus' | 'metro'; X: number; Y: number };
type ShelterPoint = { id: string; name: string; capacity: number; X: number; Y: number };

// stroke 只給稀疏的 Shelters 用；Stations（公車站+捷運站，數千個且沿路密集排列）
// 加描邊會在密集路段疊成一片黑，所以拿掉。
const buildLayer = <T extends { X: number; Y: number }>(
  id: string,
  rows: T[] | undefined,
  color: [number, number, number, number],
  radius: number,
  stroke: boolean
) => {
  if (!rows || rows.length === 0) return null;
  return new ScatterplotLayer({
    id,
    data: rows,
    getPosition: (d: T) => [d.X, d.Y, 0],
    getFillColor: color,
    stroked: stroke,
    getLineColor: [10, 10, 15, 255],
    lineWidthMinPixels: 1,
    radiusUnits: 'pixels',
    getRadius: radius,
    pickable: true,
    parameters: { depthTest: false },
  } as any);
};

export const useFacilityPointsLayer = () => {
  const { stationsVisible, sheltersVisible } = useMapStore(
    useShallow((s) => ({
      // Stations 只在 mass_evacuation 有意義、Shelters 只在 shelter_in_place 有意義——
      // 面板上已經把不相關的 checkbox 藏起來，這裡再跟 scenarioType 綁一次，
      // 避免切情境後殘留的 visibleLayers 舊狀態讓不該出現的圖層跑出來。
      stationsVisible: (s.visibleLayers[LAYER_IDS.STATIONS] ?? true) && s.scenarioType === 'mass_evacuation',
      sheltersVisible: (s.visibleLayers[LAYER_IDS.SHELTERS] ?? true) && s.scenarioType === 'shelter_in_place',
    }))
  );

  const { data: busStops } = useSql<{ id: string; name: string; X: number; Y: number }>({
    query: `SELECT stop_id AS id, stop_name AS name, X, Y FROM read_csv_auto('${BUS_STOPS_URL}')`,
  });
  const { data: metroStations } = useSql<{ id: string; name: string; X: number; Y: number }>({
    query: `SELECT station_id AS id, station_name AS name, X, Y FROM read_csv_auto('${METRO_STATIONS_URL}')`,
  });
  const { data: shelters } = useSql<ShelterPoint>({
    query: `SELECT shelter_id AS id, shelter_name AS name, capacity, X, Y FROM read_csv_auto('${SHELTERS_URL}')`,
  });

  return useMemo(() => {
    const layers = [];

    // 站點：公車站＋捷運站合併成同一個顏色，代表「站點」這個語意類別；tooltip 用 kind 區分文字
    if (stationsVisible) {
      const stations: StationPoint[] = [
        ...(busStops?.toArray() ?? []).map((r) => ({ ...r, kind: 'bus' as const })),
        ...(metroStations?.toArray() ?? []).map((r) => ({ ...r, kind: 'metro' as const })),
      ];
      const stationLayer = buildLayer('facility-stations', stations, FACILITY_STATION_COLOR, 4, false);
      if (stationLayer) layers.push(stationLayer);
    }

    if (sheltersVisible) {
      const shelterLayer = buildLayer('facility-shelters', shelters?.toArray(), FACILITY_SHELTER_COLOR, 6, true);
      if (shelterLayer) layers.push(shelterLayer);
    }

    return layers;
  }, [stationsVisible, sheltersVisible, busStops, metroStations, shelters]);
};

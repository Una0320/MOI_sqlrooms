import { useEffect, useMemo, useState } from 'react';
import { PathLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { useResolvedFiles } from './useResolvedFiles';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/constants/map';
import {
  LOS_COLORS,
  ROAD_WIDTH_MAX_PX,
  ROAD_WIDTH_MIN_PX,
  roadWidthPx,
  roadWidthScaleForZoom,
  type LOSLevel,
} from '@/constants/roadService';

type RoadLink = {
  path: [number, number][];
  vc: number;
  width: number; // px
  los: LOSLevel;
};

type RoadFeature = {
  geometry: { coordinates: [number, number][] };
  properties: Record<string, number | string>;
};

type RoadServiceData = { links: RoadLink[] };

// GeoJSON 有 ~10MB，不走 DuckDB（不需要 SQL，也避免為了讀 geojson 載 spatial extension）。
// 用模組層級 Map 以 URL 快取：切情境、關掉再開圖層都不會重抓，且只在圖層第一次被打開時才下載。
const cache = new Map<string, Promise<RoadServiceData>>();

const loadRoadService = (url: string): Promise<RoadServiceData> => {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`road service fetch failed: ${r.status}`);
        return r.json();
      })
      .then((geo) => {
        const links: RoadLink[] = (geo.features as RoadFeature[]).map((f) => {
          const props = f.properties;
          return {
            path: f.geometry.coordinates,
            vc: props['V/C'] as number,
            width: roadWidthPx(props['log_V/C'] as number),
            los: props.LOS as LOSLevel,
          };
        });
        // 由低到高排序：壅塞（D/E/F）的路段最後畫，不會被大量 A 級細線蓋住
        links.sort((a, b) => a.vc - b.vc);
        return { links };
      });
    p.catch(() => cache.delete(url)); // 失敗不留快取，下次打開圖層可重試
    cache.set(url, p);
  }
  return p;
};

export const useRoadServiceLayer = (currentZoom: number) => {
  const visible = useMapStore((s) => s.visibleLayers[LAYER_IDS.ROAD_SERVICE] ?? false);
  const { roadServiceUrl: url } = useResolvedFiles();
  const active = visible && !!url;

  const [loaded, setLoaded] = useState<{ url: string; data: RoadServiceData } | null>(null);
  useEffect(() => {
    if (!active || !url) return;
    let cancelled = false;
    loadRoadService(url)
      .then((data) => !cancelled && setLoaded({ url, data }))
      .catch((e) => console.error('[useRoadServiceLayer]', e));
    return () => {
      cancelled = true;
    };
  }, [active, url]);

  const data = active && loaded?.url === url ? loaded.data : null;

  // 資料 / 可見性變動時才重建 layer 資料；zoom 只改 widthScale（updateTriggers 不需要重算 path）
  const widthScale = roadWidthScaleForZoom(currentZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);

  return useMemo(() => {
    if (!data) return null;
    return new PathLayer<RoadLink>({
      id: 'road-service-layer',
      data: data.links,
      getPath: (d) => d.path,
      getColor: (d) => LOS_COLORS[d.los] ?? LOS_COLORS.A,
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      widthScale,
      widthMinPixels: ROAD_WIDTH_MIN_PX,
      widthMaxPixels: ROAD_WIDTH_MAX_PX * 1.6,
      capRounded: true,
      jointRounded: true,
      pickable: false,
    });
  }, [data, widthScale]);
};


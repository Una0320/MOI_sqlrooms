import type { Geometry, MultiPolygon, Polygon } from "geojson";
import type { TownFeature } from "./GeofanceLayer";

type Point = [number, number];
type BoundingBox = [number, number, number, number];

type IndexedTown = {
  bounds: BoundingBox;
  feature: TownFeature;
  townCode: string;
};

export type TownGeometryIndex = {
  towns: IndexedTown[];
};

const isPointInRing = ([x, y]: Point, ring: number[][]) => {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInPolygon = (point: Point, coordinates: Polygon["coordinates"]) => {
  if (!coordinates.length || !isPointInRing(point, coordinates[0])) {
    return false;
  }

  return !coordinates.slice(1).some((hole) => isPointInRing(point, hole));
};

const isPointInGeometry = (point: Point, geometry: Geometry | null | undefined) => {
  if (!geometry) {
    return false;
  }

  if (geometry.type === "Polygon") {
    return isPointInPolygon(point, (geometry as Polygon).coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry as MultiPolygon).coordinates.some((polygon) => isPointInPolygon(point, polygon));
  }

  return false;
};

const extendBoundsWithRing = (bounds: BoundingBox, ring: number[][]) => {
  for (const [x, y] of ring) {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  }
};

const getGeometryBounds = (geometry: Geometry | null | undefined): BoundingBox | null => {
  if (!geometry) {
    return null;
  }

  const bounds: BoundingBox = [Infinity, Infinity, -Infinity, -Infinity];

  if (geometry.type === "Polygon") {
    for (const ring of (geometry as Polygon).coordinates) {
      extendBoundsWithRing(bounds, ring);
    }
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of (geometry as MultiPolygon).coordinates) {
      for (const ring of polygon) {
        extendBoundsWithRing(bounds, ring);
      }
    }
  } else {
    return null;
  }

  return Number.isFinite(bounds[0]) ? bounds : null;
};

const isPointInBounds = ([x, y]: Point, bounds: BoundingBox) =>
  x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];

const getPointCacheKey = ([x, y]: Point) => `${x},${y}`;

export const buildTownGeometryIndex = (features: TownFeature[]) => ({
  towns: features.flatMap((feature) => {
    const townCode = feature.properties?.town_code;
    const bounds = getGeometryBounds(feature.geometry);

    if (!townCode || !bounds) {
      return [];
    }

    return [{ bounds, feature, townCode }];
  }),
});

export const resolveTownCodeByPoint = (
  point: Point,
  index: TownGeometryIndex,
  cache: Map<string, string | null>
) => {
  const cacheKey = getPointCacheKey(point);
  const cachedTownCode = cache.get(cacheKey);

  if (cachedTownCode !== undefined) {
    return cachedTownCode;
  }

  for (const town of index.towns) {
    if (!isPointInBounds(point, town.bounds)) {
      continue;
    }

    if (isPointInGeometry(point, town.feature.geometry)) {
      cache.set(cacheKey, town.townCode);
      return town.townCode;
    }
  }

  cache.set(cacheKey, null);
  return null;
};

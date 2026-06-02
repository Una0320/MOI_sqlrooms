import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const DATA_URL = `${import.meta.env.VITE_TOWN_SELECT_GEOJSON_FILE_NAME}`;

export type TownProperties = {
  city_name?: string;
  city_name_en?: string;
  town_name?: string;
  town_code?: string;
};

export type TownFeature = Feature<Geometry, TownProperties>;
export type TownFeatureCollection = FeatureCollection<Geometry, TownProperties>;

export const TAMSUI_TOWN_CODE = "65000100";

export const getPathPointFromRow = (
  pathValues: ArrayLike<number>,
  row: number,
  endpoint: "source" | "target"
): [number, number] => {
  const offset = endpoint === "source" ? 0 : 2;

  return [Number(pathValues[row * 4 + offset]), Number(pathValues[row * 4 + offset + 1])];
};

export const useTownFeatures = () => {
  const [features, setFeatures] = useState<TownFeature[] | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadFeatures = async () => {
      const response = await fetch(DATA_URL);
      const collection = (await response.json()) as TownFeatureCollection;

      if (isMounted) {
        setFeatures(collection.features);
      }
    };

    loadFeatures().catch(() => {
      if (isMounted) {
        setFeatures(null);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return features;
};

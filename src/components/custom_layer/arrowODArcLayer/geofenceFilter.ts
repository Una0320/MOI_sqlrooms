
import { useMemo } from "react";
import * as arrow from "apache-arrow";
import { buildTownGeometryIndex, resolveTownCodeByPoint, TownGeometryIndex } from "./geoFanceLayer/townGeometryService";
import { getPathPointFromRow, TownFeature } from "./geoFanceLayer/GeofanceLayer";

export type ODTownCodes = {
  sourceTownCodes: Int32Array[];
  targetTownCodes: Int32Array[];
};

export type ODTownFilterMask = Uint8Array[];

const buildBatchTownCodes = (
  batch: arrow.RecordBatch,
  geometryIndex: TownGeometryIndex,
  pointTownCodeCache: Map<string, string | null>
) => {
  const pathData = batch.getChild("paths");

  if (!pathData) {
    return {
      sourceTownCodes: new Int32Array(),
      targetTownCodes: new Int32Array(),
    };
  }

  const pathValues = pathData.data[0]?.children?.[0]?.values as ArrayLike<number> | undefined;

  if (!pathValues) {
    return {
      sourceTownCodes: new Int32Array(pathData.length),
      targetTownCodes: new Int32Array(pathData.length),
    };
  }

  const sourceTownCodes = new Int32Array(pathData.length);
  const targetTownCodes = new Int32Array(pathData.length);

  for (let row = 0; row < pathData.length; row++) {
    const sourcePoint = getPathPointFromRow(pathValues, row, "source");
    const targetPoint = getPathPointFromRow(pathValues, row, "target");
    const sourceTownCode = resolveTownCodeByPoint(sourcePoint, geometryIndex, pointTownCodeCache);
    const targetTownCode = resolveTownCodeByPoint(targetPoint, geometryIndex, pointTownCodeCache);

    sourceTownCodes[row] = Number(sourceTownCode ?? 0);
    targetTownCodes[row] = Number(targetTownCode ?? 0);
  }

  return {
    sourceTownCodes,
    targetTownCodes,
  };
};

export const buildODTownCodes = (
  table: arrow.Table,
  features: TownFeature[]
): ODTownCodes => {
  const geometryIndex = buildTownGeometryIndex(features);
  const pointTownCodeCache = new Map<string, string | null>();

  const batchTownCodes = table.batches.map((batch) =>
    buildBatchTownCodes(batch, geometryIndex, pointTownCodeCache)
  );

  return {
    sourceTownCodes: batchTownCodes.map((batch) => batch.sourceTownCodes),
    targetTownCodes: batchTownCodes.map((batch) => batch.targetTownCodes),
  };
};

export const useODTownCodes = (
  data: arrow.Table | null,
  features: TownFeature[] | null
) =>
  useMemo(() => {
    if (!data || !features) {
      return null;
    }

    return buildODTownCodes(data, features);
  }, [data, features]);

export const buildODTownFilterMask = (
  townCodes: ODTownCodes,
  selectedSourceTownCode?: number | null,
  selectedTargetTownCode?: number | null
): ODTownFilterMask =>
  townCodes.sourceTownCodes.map((sourceTownCodes, batchIndex) => {
    const targetTownCodes = townCodes.targetTownCodes[batchIndex];
    const mask = new Uint8Array(sourceTownCodes.length);

    for (let row = 0; row < sourceTownCodes.length; row++) {
      const sourceMatches = selectedSourceTownCode
        ? sourceTownCodes[row] === selectedSourceTownCode
        : true;
      const targetMatches = selectedTargetTownCode
        ? (targetTownCodes?.[row] ?? 0) === selectedTargetTownCode
        : true;

      mask[row] = sourceMatches && targetMatches ? 1 : 0;
    }

    return mask;
  });

export const useODTownFilterMask = (
  townCodes: ODTownCodes | null,
  selectedSourceTownCode?: number | null,
  selectedTargetTownCode?: number | null
) =>
  useMemo(() => {
    if (!townCodes) {
      return null;
    }

    return buildODTownFilterMask(townCodes, selectedSourceTownCode, selectedTargetTownCode);
  }, [townCodes, selectedSourceTownCode, selectedTargetTownCode]);

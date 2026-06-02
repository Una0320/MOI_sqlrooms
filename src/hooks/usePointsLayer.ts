import { useMemo, useRef } from 'react';
import * as arrow from 'apache-arrow';
import { useShallow } from '@sqlrooms/room-shell';
import { ScatterplotLayer } from '@deck.gl/layers';

import { useMapStore } from '@/zustand/useMapStore';
import { LAYER_IDS } from '@/constants/layers';
import { AGENT_MODE_TRIP_COLORS } from '@/constants/map';

const LAYER_ID = 'trips-point';
// zoom > 此值（拉近）才顯示點位；zoom ≤ 此值時由 TripsLayer 尾巴呈現
export const ZOOM_THRESHOLD = 11;

type AgentCache = {
  pathFlat: number[];   // 正規化後永遠是 flat: [x0,y0,x1,y1,...]
  timestamps: number[];
  modes: number[];      // 可以是 per-segment 或 per-trip 單一值
};

export const usePointsLayer = (
  arrowTable: arrow.Table | undefined,
  currentZoom: number,
) => {
  const { time, selectedModes, visible } = useMapStore(
    useShallow((s) => ({
      time: s.time,
      selectedModes: s.selectedModes,
      visible: s.visibleLayers[LAYER_IDS.POINTS] ?? true,
    }))
  );

  const memoryRef = useRef<{
    sourceData: arrow.Table;
    agents: AgentCache[];
    positions: Float32Array;
    colors: Uint8Array;
    numInstances: number;
  } | null>(null);

  return useMemo(() => {
    if (!arrowTable || !visible || currentZoom <= ZOOM_THRESHOLD) return [];

    // arrowTable 換掉時才重建快取，避免每幀 toArray()
    if (memoryRef.current?.sourceData !== arrowTable) {
      const rows = arrowTable.toArray();
      const agents: AgentCache[] = rows.map((row: any) => {
        // paths: List<FixedSizeList<2,Float32>> → toJSON() 回傳 [[x0,y0],...] 或已是 flat
        const rawPaths = row.paths?.toJSON ? row.paths.toJSON() : Array.from(row.paths ?? []);
        const isFlat = rawPaths.length > 0 && typeof rawPaths[0] === 'number';
        const pathFlat: number[] = isFlat
          ? Array.from(rawPaths as number[])
          : (rawPaths as any[]).flatMap((pt: any) => [Number(pt[0]), Number(pt[1])]);

        const rawTs = row.timestamps?.toJSON ? row.timestamps.toJSON() : Array.from(row.timestamps ?? []);
        const rawModes = row.modes?.toJSON ? row.modes.toJSON() : Array.from(row.modes ?? []);

        return {
          pathFlat,
          timestamps: (rawTs as any[]).map(Number),
          modes: (rawModes as any[]).map(Number),
        };
      });

      memoryRef.current = {
        sourceData: arrowTable,
        agents,
        positions: new Float32Array(rows.length * 3),
        colors: new Uint8Array(rows.length * 4),
        numInstances: rows.length,
      };
    }

    const { agents, positions, colors, numInstances } = memoryRef.current!;
    const dynamicRadius = Math.min(8, Math.max(2, currentZoom - 8));

    for (let i = 0; i < numInstances; i++) {
      const { pathFlat, timestamps, modes } = agents[i];
      const numPoints = timestamps.length;

      if (!pathFlat.length || numPoints === 0) {
        colors[i * 4 + 3] = 0;
        continue;
      }

      const tStart = timestamps[0];
      const tEnd = timestamps[numPoints - 1];

      if (time < tStart || time > tEnd) {
        colors[i * 4 + 3] = 0;
        continue;
      }

      let found = false;
      for (let j = 0; j < numPoints - 1; j++) {
        const t1 = timestamps[j];
        const t2 = timestamps[j + 1];
        if (time < t1 || time > t2) continue;

        // modes 可能是 per-segment（長度 = numPoints-1）或 per-trip（長度 1）
        const currentMode = modes.length > 1 ? modes[j] : (modes[0] ?? 1);

        if (!selectedModes.includes(currentMode)) {
          colors[i * 4 + 3] = 0;
          found = true;
          break;
        }

        const p1x = pathFlat[j * 2];
        const p1y = pathFlat[j * 2 + 1];
        const p2x = pathFlat[(j + 1) * 2];
        const p2y = pathFlat[(j + 1) * 2 + 1];

        const ratio = t2 > t1 ? (time - t1) / (t2 - t1) : 0;
        positions[i * 3]     = p1x + (p2x - p1x) * ratio;
        positions[i * 3 + 1] = p1y + (p2y - p1y) * ratio;
        positions[i * 3 + 2] = 0;

        const colorIndex = Math.floor(Math.log2(currentMode));
        const modeColor = AGENT_MODE_TRIP_COLORS[colorIndex] ?? [255, 255, 255, 200];
        colors[i * 4]     = modeColor[0];
        colors[i * 4 + 1] = modeColor[1];
        colors[i * 4 + 2] = modeColor[2];
        colors[i * 4 + 3] = modeColor[3] ?? 200;

        found = true;
        break;
      }

      if (!found) colors[i * 4 + 3] = 0;
    }

    return [
      new ScatterplotLayer({
        id: LAYER_ID,
        data: {
          length: numInstances,
          attributes: {
            getPosition: { value: new Float32Array(positions), size: 3 },
            getFillColor: { value: new Uint8Array(colors), size: 4 },
          },
        },
        radiusUnits: 'pixels',
        getRadius: dynamicRadius,
        parameters: {
          depthTest: false,
          blend: true,
          blendColorSrcFactor: 'src-alpha' as const,
          blendColorDstFactor: 'one' as const,
          blendColorOperation: 'add' as const,
        },
      } as any),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrowTable, visible, currentZoom, time, selectedModes]);
};

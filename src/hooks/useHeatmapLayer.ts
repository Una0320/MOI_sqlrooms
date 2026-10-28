import { useMemo } from 'react';
import { useSql } from '@sqlrooms/duckdb';
import { useShallow } from '@sqlrooms/room-shell';
import { PathLayer } from '@deck.gl/layers';

import { AGENT_MODE_TRIP_COLORS } from '../constants/map';
import { LAYER_IDS } from '../constants/layers';
import { useMapStore } from '../zustand/useMapStore';
import { useResolvedFiles } from './useResolvedFiles';

// 08_heatmap：一列 = 一條路段 × 5 分鐘 × 一種運具（走路是人數，其餘是車數）。
// 選時間窗時取 t 落在窗內的列，依 link_id、mode 加總 count，線形 join heatmap_links。
const BUCKET_SEC = 300;

const buildQuery = (heatmapUrl: string | null, linksUrl: string | null, [from, to]: [number, number]) =>
  heatmapUrl && linksUrl
    ? `
    SELECT l.paths AS paths, h.mode AS mode, h.cnt AS cnt
    FROM (
      SELECT link_id, mode, SUM(count) AS cnt
      FROM read_parquet('${heatmapUrl}')
      WHERE t + ${BUCKET_SEC} > ${from} AND t < ${to}
      GROUP BY link_id, mode
    ) h
    JOIN read_parquet('${linksUrl}') l USING (link_id)
  `
    : `SELECT NULL AS paths, NULL AS mode, NULL AS cnt WHERE FALSE`;

type HeatLink = { path: Float32Array; cnt: number };

// debouncedTimeRange 由 MapView 提供（300ms debounce、播放時凍結），避免拖時間軸時每一幀都重打查詢。
export const useHeatmapLayer = (debouncedTimeRange: [number, number]) => {
  const { selectedModes, visible } = useMapStore(
    useShallow((s) => ({
      selectedModes: s.selectedModes,
      visible: s.visibleLayers[LAYER_IDS.HEATMAP] ?? false,
    })),
  );
  const { heatmapUrl, heatmapLinksUrl } = useResolvedFiles();

  // 圖層沒打開時查零列 SQL，所以 ~50MB 的 parquet 只在第一次打開時才開始讀
  const query = buildQuery(visible ? heatmapUrl : null, heatmapLinksUrl, debouncedTimeRange);
  const { data } = useSql<Record<string, unknown>>({ query });
  const arrowTable = data?.arrowTable;

  // 依運具分組（mode 勾選只在 JS 端過濾，不重打查詢）
  const byMode = useMemo(() => {
    const groups = new Map<number, HeatLink[]>();
    if (!arrowTable || arrowTable.numRows === 0) return groups;
    const pathsCol = arrowTable.getChild('paths');
    const modeCol = arrowTable.getChild('mode');
    const cntCol = arrowTable.getChild('cnt');
    if (!pathsCol || !modeCol || !cntCol) return groups;
    for (let i = 0; i < arrowTable.numRows; i++) {
      const mode = Number(modeCol.get(i));
      let arr = groups.get(mode);
      if (!arr) groups.set(mode, (arr = []));
      arr.push({
        path: (pathsCol.get(i) as { toArray(): Float32Array }).toArray(),
        cnt: Number(cntCol.get(i)),
      });
    }
    return groups;
  }, [arrowTable]);

  const selectedModesKey = selectedModes.join(',');

  return useMemo(() => {
    if (!visible) return [];

    // 每個被勾選的運具各一個 PathLayer（各自的顏色），加法混合疊出熱力感；
    // 流量（count）決定線寬與透明度，用 log 壓縮（路段流量極度偏斜），以該運具這個時間窗內的最大值為 1。
    return selectedModes.flatMap((modeBitmask) => {
      const links = byMode.get(modeBitmask);
      if (!links || links.length === 0) return [];
      const modeIndex = Math.floor(Math.log2(modeBitmask));
      const base = AGENT_MODE_TRIP_COLORS[modeIndex] ?? [255, 255, 255, 150];
      let max = 1;
      for (const l of links) if (l.cnt > max) max = l.cnt;
      const norm = Math.log1p(max);
      const t = (d: HeatLink) => Math.log1p(d.cnt) / norm;

      return [
        new PathLayer<HeatLink>({
          id: `${LAYER_IDS.HEATMAP}-mode-${modeBitmask}`,
          data: links,
          positionFormat: 'XY',
          getPath: (d: HeatLink) => d.path as unknown as number[],
          getColor: (d: HeatLink) => [base[0], base[1], base[2], 40 + t(d) * 140],
          getWidth: (d: HeatLink) => 1 + t(d) * 3,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          parameters: {
            depthTest: false,
            blend: true,
            blendColorSrcFactor: 'src-alpha',
            blendColorDstFactor: 'one', // additive blend → 熱力疊加效果
            blendColorOperation: 'add',
          },
        } as any),
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byMode, visible, selectedModesKey]);
};

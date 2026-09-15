# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A high-performance city-mobility trajectory visualizer built on **SQLRooms + Deck.gl + DuckDB-WASM**. It renders 20,000+ Agent-Based Modeling (ABM) trajectories from Parquet entirely in the browser, using zero-copy Arrow → GPU rendering and in-browser SQL aggregation. Originally derived from the official SQLRooms `deckgl-example`.

## Commands

```bash
yarn install      # install deps (yarn is the lockfile of record; package-lock.json also present)
yarn dev          # Vite dev server
yarn build        # tsc -b && vite build
yarn lint         # eslint .
yarn preview      # preview production build
```

There is no test suite. The data source is configured via `.env` (`VITE_DUCKDB_FILE_NAME`, `VITE_DUCKDB_CONNECTION_STRING`, `VITE_DUCKDB_OD_FILE_NAME`) — resolved once in `src/constants/data.ts` (exports `DATA_FILE_NAME` / `DATA_BASE_URL` / `DATA_URL` for trips, and `OD_FILE_NAME` / `OD_DATA_URL` for the OD-arc parquet), with sensible localhost defaults (see `.env.example`). A local HTTP server supporting Range Requests must serve the Parquet files on port 7780 for trajectories to load.

## Architecture

### Single DuckDB engine (SQLRooms connector)
All in-browser SQL goes through **one** DuckDB-WASM instance — the SQLRooms connector created in `src/store.ts` via `createWasmDuckDbConnector()`. It drives the RoomShell SQL Editor / data panel / file dropzone **and** the app's data loads:
- **Trajectory load** — `MainView.tsx` uses the SQLRooms `useSql({query})` hook (`SELECT paths, timestamps, modes FROM read_parquet('${DATA_URL}')`); the resulting `data.arrowTable` is passed as a **prop** to `<MapView arrowTable=... />`, which in turn feeds it to the trips layer, `useHeatmapLayer`, and `usePointsLayer` (all three share the one query result — zero extra DuckDB round-trips).
- **Histogram** — `timebar/TimeLine.tsx` uses `useSql` for the time-bin aggregation query, also against `read_parquet('${DATA_URL}')`.
- **OD-arc load** — `hooks/useODArcLayer.ts` runs its own `useSql({query: 'SELECT * FROM read_parquet(OD_DATA_URL)'})` against a separate parquet (`abm_od_arc_outcome.parquet`), since OD data has a different schema/granularity than the trip trajectories. Still the same connector, just a second query.

`useSql` returns `{ data: { arrowTable, rows(), toArray() }, isLoading, error }` and handles connector-init timing. Remote `read_parquet('http://...')` works natively in duckdb-wasm via Range requests. (Historically there were three separate DuckDB instances + a `window.globalArrowTable` hack; that was consolidated — do not reintroduce it.)

### State management
- **SQLRooms RoomShell store** (`src/store.ts`, `useRoomStore`) — room layout/panels; `dataSources` intentionally empty (data is loaded on demand via `useSql`). Panels: `main` (the map view) and `data` (`placement: 'sidebar'`, auto-rendered as a sidebar toggle button by `RoomShell.Sidebar`).
- **Zustand `useMapStore`** (`src/zustand/useMapStore.ts`) — all playback/UI state: `time`, `timeRange`, `displayTimeRange`, `viewTimeRange`, `isPlaying`, `timeScale`, `selectedModes`, `visibleLayers` (see the comment block at the top of the file for what each range means).
- The rAF playback loop in `MapView.tsx` reads/writes Zustand via `useMapStore.getState()` to dodge closure-stale-value traps. Components subscribe with `useShallow` + atomic selectors to avoid re-renders during playback.

### Layer registry & visibility
- `src/constants/layers.ts` centralizes layer identity: `LAYER_IDS` (`trips`/`heatmap`/`od-arc`/`points`), `LAYER_CONFIG` (id + title + `defaultVisible`), and `INITIAL_VISIBLE_LAYERS` derived from it.
- `useMapStore.visibleLayers` (`Record<LayerId, boolean>`) + `toggleLayer(id)` hold the on/off state; each layer hook/section in `MapView.tsx` reads its own `visibleLayers[LAYER_IDS.X]` to decide whether to build/return the layer.
- `LayerPanel.tsx` renders the checkbox UI (top-right, alongside `ModeSelector`) driven by `LAYER_CONFIG`/`toggleLayer` — adding a layer to the panel means adding one entry to `LAYER_CONFIG`, no other UI change needed.
- Trips and Points are zoom-LOD-exclusive rather than independently toggled: `MapView.tsx` only builds the trips `TripsLayer` when `currentZoom <= ZOOM_THRESHOLD` (11, from `usePointsLayer.ts`), and only builds points above it — the checkbox for each still gates on top of that.

### Rendering pipeline (zero-copy)
- `MapView.tsx` — MapLibre basemap + `MapboxOverlay` Deck.gl overlay; runs the `requestAnimationFrame` playback loop; composes layers in order heatmap → od-arc → trips/points (later pushes draw on top).
- `src/components/custom_layer/arrowTripsLayer/ArrowTripsLayer.ts` — a `CompositeLayer` that reads Arrow `RecordBatch` buffers directly. It slices the underlying `Float32Array`/`Uint8Array` (`paths`, `timestamps`, `modes` columns) via `subarray` using the batch's `valueOffsets`, rebuilds `startIndices` (offset ÷ 2 for [x,y] pairs), and feeds typed-array `attributes` straight into a per-batch `TripsLayer` — no JSON parsing. `updateState` caches the recomputed indices.
- `hooks/usePointsLayer.ts` — builds a single `ScatterplotLayer` (all agents as GPU instance attributes) as the LOD replacement for trips once zoomed in past `ZOOM_THRESHOLD`. Caches the per-agent flattened path/timestamp/mode arrays in a `useRef` keyed on `arrowTable` identity, then re-fills `positions`/`colors` typed arrays every render by interpolating each agent's position at `time` — avoids re-parsing the Arrow table every frame.
- `hooks/useHeatmapLayer.ts` — one `ArrowPathLayer` per selected mode (own color + GPU `filterCategories`), additive-blended for a heat-density look; shares the trips `arrowTable` (no second query) and is gated behind a 300ms-debounced `timeRange` (frozen while `isPlaying`) so scrubbing doesn't rebuild layers every frame.
- `hooks/useODArcLayer.ts` — builds one `ArrowODArcLayer` from its own OD parquet query (see above), filtered by `timeRange`/`selectedModes`.
- `arrowODArcLayer/` and `arrowPathLayer/` are **live** — used by `useODArcLayer`/`useHeatmapLayer` respectively, not WIP experiments. `arrowODArcLayer/geoFanceLayer/` (geofence-based OD filtering) is still unused/WIP.

### Mode filtering (GPU bitmask)
- Mobility modes (WALK/CAR/BICYCLE/BUS/RAIL) map to bits `[1,2,4,8,16]` (`src/constants/map.ts`).
- `ModeSelector` toggles bits in `selectedModes`; `MapView` OR-reduces them into a single bitmask passed as `filterBitMask`.
- `ModeObjectPropsExtension` (`.../arrowTripsLayer/utils/extensions.ts`) is a Deck.gl `LayerExtension` that adds the per-vertex `mode_type` attribute and pushes the bitmask + `colorMap` as a shader uniform (`mode-shader-module.ts`), so show/hide happens in the WebGL shader.

### Timebar
`src/components/timebar/` — `Timebar` (play/pause + speed), `TimeLine` (dual-range slider: display window vs. active range), `AdjustTimeSpeedRatio`. Uses shadcn/ui `Button`/`Card`.

## Conventions
- **`apache-arrow` is pinned to `17.0.0`** (exact, plus `resolutions`/`overrides` in `package.json`). Do NOT bump it. The SQLRooms packages pin `17.0.0` and `@duckdb/duckdb-wasm` requires `^17`; if a second arrow version (e.g. 21) gets hoisted, the SQLRooms connector's `new arrow.Table(batches)` receives RecordBatches built by a *different* arrow instance, the internal `instanceof RecordBatch` check fails, and the Table constructor recurses infinitely → `RangeError: Maximum call stack size exceeded` on every query. Keep one arrow version across the whole tree.
- **Time unit is seconds everywhere** (0–86400), in both Zustand and DuckDB queries. Do not mix in JS milliseconds (formatting helpers in `timebar/utils.ts` multiply by 1000 only for display).
- Path alias `@/` → `src/` (configured in `vite.config.ts` and tsconfig).
- shadcn/ui configured via `components.json` (style `radix-nova`, base color neutral); UI primitives in `src/components/ui/`.
- Much of the codebase has Traditional Chinese comments; match the surrounding language when editing existing files.
- Deploy target is Netlify (`netlify.toml`): `npm run build` → `dist`, with `CI=false` and increased Node heap.

# 個人偏好

- 預設用 Sonnet 模型回應，除非任務需要深度推理才切 Opus
- 不需要時不要主動讀取整個專案，明確讀取我指定的檔案就好
- 回應簡潔，不需要過多前言鋪陳
- 改檔案前先告訴我會改什麼，等我同意再動手
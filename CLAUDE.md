# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A high-performance city-mobility trajectory visualizer built on **SQLRooms + Deck.gl + DuckDB-WASM**. It renders 20,000+ Agent-Based Modeling (ABM) trajectories from Parquet entirely in the browser, using zero-copy Arrow → GPU rendering and in-browser SQL aggregation. Originally derived from the official SQLRooms `deckgl-example`; now extended into a **civil-protection scenario viewer** with two top-level scenario types (shelter-in-place / mass-evacuation), each with its own trajectory data, OD arcs, and scenario-specific overlay layers (transit stations/waiting crowds vs. shelters/capacity).

## Commands

```bash
yarn install      # install deps (yarn is the lockfile of record; package-lock.json also present)
yarn dev          # Vite dev server
yarn build        # tsc -b && vite build
yarn lint         # eslint .
yarn preview      # preview production build
```

There is no test suite. `.env` needs `VITE_DUCKDB_CONNECTION_STRING` (base URL of a local HTTP server that supports **Range Requests**, default `http://localhost:7780`) — every actual filename is resolved from `src/constants/data.ts`'s `SCENARIO_CONFIG`, keyed by the currently-selected scenario type (see below), not from individual `.env` vars anymore. `VITE_MAPTILER_API_KEY` is optional: set it to switch the basemap (`MapView.tsx`'s `MAP_STYLE`) from CARTO's `dark-matter-gl-style` (OSM data rebuilt as infrequently as once a year per CARTO's own docs) to MapTiler's `dataviz-dark` (rebuilt weekly) — get a free key at cloud.maptiler.com/account/keys. Missing the key just falls back to CARTO with a console warning, it doesn't break local dev.

### Local test data (`sim_data/`)

Local development points at `sim_data/20260910/` — a delivered test batch (git-ignored, ask for a fresh copy if missing) with its own `README.md` describing 5 subfolders (`01_trajectory`, `02_points`, `03_stop_counts`, `04_shelter_capacity`, `05_moi_sim`) across 6 scenarios (`pt10/20/40`, `evac_ratio10/20/40`). This app currently only wires up **`05_moi_sim`** (trips + OD arc — schema-compatible drop-in for the existing `paths/timestamps/modes` query, so no query changes needed), **`02_points`** (static bus stops/metro stations/shelters), **`03_stop_counts`**, and **`04_shelter_capacity`**, fixed to one sub-scenario per type (`pt10` for mass-evacuation, `evac_ratio10` for shelter-in-place — see `SCENARIO_CONFIG`). `01_trajectory` (per-mode split files) and `05_moi_sim/road_service_*.geojson` (road V/C service level) are **not** wired up yet.

Since `sim_data/` isn't served anywhere in production, local dev needs a standalone static file server with Range + CORS support pointed at it, e.g.:

```bash
npx http-server sim_data/20260910 -p 7780 --cors
```

`VITE_DUCKDB_CONNECTION_STRING` just needs to match that server's base URL.

## Architecture

### Scenario switching (shelter-in-place vs. mass-evacuation)

- `useMapStore.scenarioType: 'shelter_in_place' | 'mass_evacuation'` (default `'mass_evacuation'`) is the single source of truth for which dataset is loaded; `setScenarioType(type)` also resets `time`/`timeRange`/`isPlaying` to their defaults, since the two scenario types have wildly different valid time windows (`pt*` ≈ 70h, `evac_ratio*` ≈ 1.5h) and leaving the playhead where it was would silently show nothing.
- `<ScenarioSwitcher />` (top-center of the map) is the only UI for this — two buttons, labels sourced from `SCENARIO_CONFIG[type].label`.
- `src/constants/data.ts`'s `SCENARIO_CONFIG: Record<ScenarioType, ScenarioFileSet>` is the file-path lookup table: each entry has `dataUrl`/`odDataUrl` (always present) and `stopCountsUrl`/`shelterCapacityUrl` (mutually exclusive — one is always `null` for a given type; the owning hook detects `null` and substitutes a guaranteed-zero-row query rather than erroring). Every consumer (`MainView.tsx`, `timebar/TimeLine.tsx`, `useODArcLayer.ts`, `useStopCountsLayer.ts`, `useShelterCapacityLayer.ts`) reads `scenarioType` from the store and rebuilds its query string from `SCENARIO_CONFIG` on every render — `useSql` refetches automatically when the query string changes, so switching scenarios is just a state update, no manual invalidation.
- Layer availability follows the same split: `LAYER_CONFIG` entries carry an optional `scenario` field (`LAYER_IDS.STATIONS`/`STOP_COUNTS` → `'mass_evacuation'`; `LAYER_IDS.SHELTERS`/`SHELTER_CAPACITY` → `'shelter_in_place'`), and `LayerPanel.tsx` filters the checkbox list by it — the irrelevant checkboxes disappear entirely rather than sitting there disabled. `useFacilityPointsLayer.ts` additionally ANDs its own visibility with `scenarioType` directly (defense in depth against a stale `visibleLayers` flag surviving a scenario switch).

### Single DuckDB engine (SQLRooms connector)
All in-browser SQL goes through **one** DuckDB-WASM instance — the SQLRooms connector created in `src/store.ts` via `createWasmDuckDbConnector()`. It drives the app's data loads below; the RoomShell chrome that used to expose it directly (sidebar with a SQL Editor / Data panel / file-dropzone / command palette toggle) was removed from `src/room.tsx` — it's end-user-facing product now, not a debug dashboard. `DataPanel.tsx` and the `data` panel registration in `src/store.ts` are still there (unreachable, harmless) so the sidebar can be added back trivially if that tooling is needed again later.
- **Trajectory load** — `MainView.tsx` uses the SQLRooms `useSql({query})` hook (`SELECT paths, timestamps, modes FROM read_parquet('${SCENARIO_CONFIG[scenarioType].dataUrl}')`); the resulting `data.arrowTable` is passed as a **prop** to `<MapView arrowTable=... />`, which in turn feeds it to the trips layer, `useHeatmapLayer`, and `usePointsLayer` (all three share the one query result — zero extra DuckDB round-trips).
- **Histogram** — `timebar/TimeLine.tsx` uses `useSql` for the time-bin aggregation query, also against the current scenario's `dataUrl`.
- **OD-arc load** — `hooks/useODArcLayer.ts` runs its own `useSql({query: 'SELECT * FROM read_parquet(odDataUrl)'})` against the scenario's OD parquet, since OD data has a different schema/granularity than the trip trajectories. Still the same connector, just a second query.
- **Facilities load** — `hooks/useFacilityPointsLayer.ts` runs three independent `useSql` queries against the *static* (scenario-independent) `02_points/*.csv` files: bus stops + metro stations (merged client-side into one "Stations" dataset) and shelters.
- **Stop Counts load** — `hooks/useStopCountsLayer.ts` runs one `useSql` query that joins `03_stop_counts` (per-stop, per-time-bucket waiting counts) against `bus_stops.csv`/`metro_stations.csv` (for coordinates) via `LEFT JOIN ... ON mode = 8/16`.
- **Shelter Capacity load** — `hooks/useShelterCapacityLayer.ts` runs one `useSql` query against `04_shelter_capacity` directly (X/Y/name/capacity are already baked into that table, no join needed).

`useSql` returns `{ data: { arrowTable, rows(), toArray() }, isLoading, error }` and handles connector-init timing. Remote `read_parquet('http://...')` works natively in duckdb-wasm via Range requests. (Historically there were three separate DuckDB instances + a `window.globalArrowTable` hack; that was consolidated — do not reintroduce it.)

### State management
- **SQLRooms RoomShell store** (`src/store.ts`, `useRoomStore`) — room layout/panels; `dataSources` intentionally empty (data is loaded on demand via `useSql`). Panels: `main` (the map view, the only one actually reachable from the UI) and `data` (`placement: 'sidebar'` — registered but currently unreachable since `src/room.tsx` no longer renders `<RoomShell.Sidebar>`). `src/room.tsx` also passes `tileClassName="p-0 bg-transparent"` to `<RoomShell.LayoutComposer>` to kill `@sqlrooms/layout`'s default per-tile `p-2 bg-secondary/10` padding/tint — otherwise the light-theme tint shows as a border around the map.
- **Zustand `useMapStore`** (`src/zustand/useMapStore.ts`) — all playback/UI state: `time`, `timeRange`, `displayTimeRange`, `viewTimeRange`, `isPlaying`, `timeScale`, `selectedModes`, `visibleLayers`, `scenarioType` (see the comment block at the top of the file for what each time range means).
- The rAF playback loop in `MapView.tsx` reads/writes Zustand via `useMapStore.getState()` to dodge closure-stale-value traps. Components subscribe with `useShallow` + atomic selectors to avoid re-renders during playback.

### Layer registry & visibility
- `src/constants/layers.ts` centralizes layer identity: `LAYER_IDS` (`trips`/`heatmap`/`od-arc`/`points`/`stations`/`shelters`/`stop-counts`/`shelter-capacity`), `LAYER_CONFIG` (id + title + `defaultVisible` + optional `color` + optional `scenario`), and `INITIAL_VISIBLE_LAYERS` derived from it.
- `useMapStore.visibleLayers` (`Record<LayerId, boolean>`) + `toggleLayer(id)` hold the on/off state; each layer hook/section in `MapView.tsx` reads its own `visibleLayers[LAYER_IDS.X]` to decide whether to build/return the layer.
- `LayerPanel.tsx` renders the checkbox UI (top-right, alongside `ModeSelector`) driven by `LAYER_CONFIG`/`toggleLayer` — adding a layer to the panel means adding one entry to `LAYER_CONFIG`, no other UI change needed. Entries with a `color` get their label text tinted to match the layer's on-map color (opacity toggles instead of white/gray on check/uncheck) — `ModeSelector.tsx` uses the same pattern for the WALK/CAR/BUS/RAIL checkboxes, tinted from `AGENT_MODE_TRIP_COLORS`. Entries with a `scenario` are filtered out of the panel entirely when it doesn't match the current `scenarioType` (see "Scenario switching" above).
- Trips and Points (`LAYER_IDS.POINTS`) are zoom-LOD-exclusive rather than independently toggled: `MapView.tsx` only builds the trips `TripsLayer` when `currentZoom <= ZOOM_THRESHOLD` (11, from `usePointsLayer.ts`), and only builds points above it — the checkbox for each still gates on top of that. **Don't confuse `LAYER_IDS.POINTS` (per-agent LOD scatter dots, replaces Trips when zoomed in) with `LAYER_IDS.STATIONS` (static bus/metro facility markers, unrelated layer, unrelated data source)** — the naming collision bit us once already.
- The map's own zoom is clamped to `[MAP_MIN_ZOOM, MAP_MAX_ZOOM]` = `[10, 15]` (`constants/map.ts`, passed as `minZoom`/`maxZoom` props to react-map-gl's `<Map>`) — zooming further than 15 doesn't add resolution this dataset can use, and `useStopCountsLayer`'s clustering ceiling is derived from the same constant (see below), so changing `MAP_MAX_ZOOM` is the one place to touch if the zoom range ever needs to change.

### Rendering pipeline (zero-copy)
- `MapView.tsx` — MapLibre basemap + `MapboxOverlay` Deck.gl overlay; runs the `requestAnimationFrame` playback loop; composes layers in order heatmap → od-arc → facilities (stations/shelters) → stop-counts → shelter-capacity → trips → points (later pushes draw on top). Also wires a single `getTooltip` callback into the overlay, branching on `info.layer.id` (`'facility-stations'` / `'facility-shelters'`) to show a hover tooltip with id/name/(capacity).
- `src/components/custom_layer/arrowTripsLayer/ArrowTripsLayer.ts` — a `CompositeLayer` that reads Arrow `RecordBatch` buffers directly. It slices the underlying `Float32Array`/`Uint8Array` (`paths`, `timestamps`, `modes` columns) via `subarray` using the batch's `valueOffsets`, rebuilds `startIndices` (offset ÷ 2 for [x,y] pairs), and feeds typed-array `attributes` straight into a per-batch `TripsLayer` — no JSON parsing. `updateState` caches the recomputed indices.
- `hooks/usePointsLayer.ts` — builds a single `ScatterplotLayer` (all agents as GPU instance attributes) as the LOD replacement for trips once zoomed in past `ZOOM_THRESHOLD`. Caches the per-agent flattened path/timestamp/mode arrays in a `useRef` keyed on `arrowTable` identity, then re-fills `positions`/`colors` typed arrays every render by interpolating each agent's position at `time` (binary search over each agent's own timestamp array, not a linear scan) — avoids re-parsing the Arrow table every frame.
- `hooks/useHeatmapLayer.ts` — one `ArrowPathLayer` per selected mode (own color + GPU `filterCategories`), additive-blended for a heat-density look; shares the trips `arrowTable` (no second query) and is gated behind a 300ms-debounced `timeRange` (frozen while `isPlaying`) so scrubbing doesn't rebuild layers every frame.
- `hooks/useODArcLayer.ts` — builds one `ArrowODArcLayer` from its own OD parquet query (see above), filtered by `timeRange`/`selectedModes`.
- `hooks/useFacilityPointsLayer.ts` — two plain `ScatterplotLayer`s: **Stations** (bus stops + metro stations merged into one dataset/color, no stroke — a stroke here makes dense clusters of nearby stops merge visually into solid black blobs) and **Shelters** (own color, stroke kept since sparse). Both `pickable: true` for the `getTooltip` hookup above. Colors (`FACILITY_STATION_COLOR`/`FACILITY_SHELTER_COLOR` in `constants/map.ts`) are deliberately outside the `AGENT_MODE_TRIP_COLORS` palette so static facility markers never look like a moving trip/agent dot of some mode.
- `hooks/useStopCountsLayer.ts` — station-level waiting-crowd bubbles with **zoom-adaptive clustering**. Two data quirks drove its design: (1) `bus_stops.csv` encodes one row per *route-stop pairing*, so a single physical stop pole commonly has several `stop_id`s at the identical coordinate (up to 16, in one measured case) — rows are first grouped by raw `stop_id`/mode, then re-grouped by rounded coordinate (`LOCATION_PRECISION` = 6 decimals) so one physical station renders as one bubble with its waiting counts summed, not several overlapping circles; (2) even after that, ~554 physical stations is too many bubbles to show at once at low zoom, so a `supercluster` spatial index (built once per mode, since bus/metro are kept in separate indices so a bubble's color stays meaningful) is queried per zoom level to merge/split bubbles — re-clustering only happens on zoom change, while the per-frame (time-dependent) work is just summing each *currently visible* cluster's live waiting values via the same binary-search step-lookup pattern as `usePointsLayer`. Renders a `ScatterplotLayer` (radius ∝ `sqrt(waiting)`) plus a `TextLayer` printing the exact summed count inside each circle — no additive/glow blending, it made dense areas unreadable.
  - ⚠ **Supercluster `maxZoom` gotcha**: querying `getClusters(bbox, zoom)` at `zoom === options.maxZoom` still returns the *clustered* tier — only `zoom > options.maxZoom` returns fully unclustered raw points (see `supercluster/index.js`'s `_limitZoom`: it builds a dedicated raw tree at `trees[maxZoom + 1]`). So the constructor's `maxZoom` must be set to **one less** than the highest zoom you'll ever query at (`CLUSTER_MAX_ZOOM = MAP_MAX_ZOOM - 1`), while the query-side clamp uses `MAP_MAX_ZOOM` itself. Getting this off-by-one backwards silently caps declustering — bubbles stop shrinking no matter how far you zoom in, and it looks like a broken/ignored zoom level rather than an off-by-one.
- `hooks/useShelterCapacityLayer.ts` — one `ScatterplotLayer`, colored by the `status` field (`SHELTER_STATUS_COLORS`: empty/low/medium/high/over) with radius scaled by `load_ratio`. Same forward-fill step-lookup as stop counts, no clustering (shelters are few enough not to need it).
- `arrowODArcLayer/` and `arrowPathLayer/` are **live** — used by `useODArcLayer`/`useHeatmapLayer` respectively, not WIP experiments. `arrowODArcLayer/geoFanceLayer/` (geofence-based OD filtering) is still unused/WIP.

### Mode filtering (GPU bitmask)
- Mobility modes (WALK/CAR/BUS/RAIL) map to bits `[1,2,8,16]` (`src/constants/map.ts`, `MOBILITY_MODE_BITS`; bit `4` is a reserved/unused slot, never present in the source data).
- `ModeSelector` toggles bits in `selectedModes`; `MapView` OR-reduces them into a single bitmask passed as `filterBitMask`.
- `ModeObjectPropsExtension` (`.../arrowTripsLayer/utils/extensions.ts`) is a Deck.gl `LayerExtension` that adds the per-vertex `mode_type` attribute and pushes the bitmask + `colorMap` as a shader uniform (`mode-shader-module.ts`), so show/hide happens in the WebGL shader.

### Timebar
`src/components/timebar/` — `Timebar` (play/pause + speed), `TimeLine` (dual-range slider: display window vs. active range), `AdjustTimeSpeedRatio`. Uses shadcn/ui `Button`/`Card`.

## Conventions
- **`apache-arrow` is pinned to `17.0.0`** (exact, plus `resolutions`/`overrides` in `package.json`). Do NOT bump it. The SQLRooms packages pin `17.0.0` and `@duckdb/duckdb-wasm` requires `^17`; if a second arrow version (e.g. 21) gets hoisted, the SQLRooms connector's `new arrow.Table(batches)` receives RecordBatches built by a *different* arrow instance, the internal `instanceof RecordBatch` check fails, and the Table constructor recurses infinitely → `RangeError: Maximum call stack size exceeded` on every query. Keep one arrow version across the whole tree.
- **Time unit is seconds everywhere** (0–86400, though `evac_ratio*`/`pt*` scenario timestamps can exceed 86400 since the underlying sim runs up to 72h), in both Zustand and DuckDB queries. Do not mix in JS milliseconds (formatting helpers in `timebar/utils.ts` multiply by 1000 only for display).
- Path alias `@/` → `src/` (configured in `vite.config.ts` and tsconfig).
- shadcn/ui configured via `components.json` (style `radix-nova`, base color neutral); UI primitives in `src/components/ui/`.
- Much of the codebase has Traditional Chinese comments; match the surrounding language when editing existing files.
- Deploy target is Netlify (`netlify.toml`): `npm run build` → `dist`, with `CI=false` and increased Node heap.
- `sim_data/` is git-ignored (large delivered test batch, not part of the repo) — local dev depends on it existing on disk plus a standalone http-server pointed at it (see Commands above). Don't assume it's present in CI/build environments.

# 個人偏好

- 預設用 Sonnet 模型回應，除非任務需要深度推理才切 Opus
- 不需要時不要主動讀取整個專案，明確讀取我指定的檔案就好
- 回應簡潔，不需要過多前言鋪陳
- 改檔案前先告訴我會改什麼，等我同意再動手

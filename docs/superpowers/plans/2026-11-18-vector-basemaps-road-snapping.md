# Vector basemaps and road snapping – Implementation plan

Spec: `docs/superpowers/specs/2026-11-18-vector-basemaps-road-snapping-design.md`

### Task 1: Config schema
- Basemap entry: `{ id, title, default?, layer }` (WMTS) or `{ id, title, default?, style }` (vector); exactly one of `layer`/`style`.
- Layer: `snapToRoads?: boolean` (default false).
- Top-level `snapping?: { tilejson, sourceLayer, exclude }` with swisstopo defaults.
- Tests in `shared/test/config-schema.test.ts`: vector basemap parses, entry with both/neither fails, snapping defaults applied.

### Task 2: Vector basemaps (web)
- `createBasemapLayer(def, onError)` returns a WMTS `TileLayer` or a lazily styled `LayerGroup`.
- Tests in `web/test/basemaps.test.ts`: WMTS unchanged; vector entry gives a hidden `LayerGroup` that does not load its style until shown.

### Task 3: Road snap source (web)
- `web/src/map/roadSnapping.ts`: `tileCoordsForExtent()`, `RoadSnapper` (TileJSON lookup, tile cache, class filter, EPSG:3857 → 2056, status `idle|loading|ready|zoom|error`).
- Tests in `web/test/roadSnapping.test.ts` with injected fetchers.

### Task 4: Edit integration
- `EditController.setSnapSource(source | null)`: keeps a `Snap` interaction last in the interaction stack while drawing/modifying.
- `EditToolbar`: snapping checkbox + status hint.
- `App.svelte`: wire snapper, toggle state (localStorage), `moveend` loading.

### Task 5: Config and docs
- `config/minigis.yaml`: vector basemaps first (light default), WMTS kept; group `Tiefbau` with `strassenzustand` (line, photos, attributes, `snapToRoads: true`).
- README config reference.

### Task 6: Verify
- `npm test`, `npm run check -w web`, `npm run build`, e2e smoke, manual check in a browser with network access to geo.admin.ch.

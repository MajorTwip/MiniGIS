# Vector basemaps, "Strassenzustand" layer and road snapping – Design

Date: 2026-11-18 · Status: requested by the user in the project thread ("yes please … add a Layer Strassenzustand under the Tree Tiefbau which allows to add polylines … snap to the roads of the vectormap of swisstopo … disablable")

## 1. Intent

1. Show swisstopo's free **vector** base maps (vectortiles.geo.admin.ch) in the basemap switcher and make the light base map the default. The existing WMTS raster maps stay available.
2. Add a line layer **Strassenzustand** in a new tree group **Tiefbau** to record road condition as polylines.
3. While drawing or reshaping lines on that layer, vertices **snap to the roads** of the swisstopo vector map. A toggle in the edit toolbar turns snapping on and off.

## 2. Decisions

- **Projection stays LV95.** The map view and all stored data stay in EPSG:2056. The vector tiles are Web Mercator; OpenLayers ≥ 10 reprojects vector tiles (and the raster part of the imagery style) into the LV95 view. No data is converted.
- **Styles via `ol-mapbox-style`.** A vector basemap is a `LayerGroup` filled by `ol-mapbox-style`'s `apply()` from the style URL. The style is loaded only the first time that basemap is shown. A load failure is shown in the sidebar like other load errors.
- **Config, not code.** A basemap entry has either `layer` (WMTS layer id, as before) or `style` (vector style URL). Snapping is enabled per layer with `snapToRoads: true`. Where the road geometry comes from is an optional top-level `snapping` section with defaults for swisstopo:
  - `tilejson`: TileJSON of `ch.swisstopo.base.vt` (tile URL template and max zoom are read from it),
  - `sourceLayer`: `transportation`,
  - `exclude`: road `class` values that are not roads (`rail`, `transit`, `ferry`, `aerialway`, …).
- **Snapping is independent of the visible basemap.** Road geometries are fetched directly as MVT tiles at the tileset's max zoom (full detail), filtered to the `transportation` layer, transformed to LV95 and kept in an in-memory vector source that feeds an OpenLayers `Snap` interaction. It works with any basemap, including the WMTS ones.
- **Load only what is needed.** Road tiles are loaded for the current view while snapping is on and a draw or modify operation is running, on every `moveend`. Tiles are cached per session. When the view would need more than 36 tiles, nothing is loaded and the toolbar says "Zum Fangen näher heranzoomen".
- **Toggle.** The edit toolbar shows a checkbox "An Strassen fangen" for layers with `snapToRoads`. It defaults to on, is remembered per browser (localStorage, best-effort), and can be switched during an operation.

## 3. Out of scope

- Colouring Strassenzustand lines by condition (styling by attribute only exists for points today).
- Snapping to features of the app's own layers.
- Splitting lines at road junctions or following a road automatically between two clicks (routing-style tracing).

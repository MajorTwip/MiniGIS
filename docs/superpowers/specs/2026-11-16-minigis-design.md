# MiniGIS – Design

Date: 2026-11-16 · Status: approved 2026-11-16 (language switched to TypeScript)

## 1. Intent

MiniGIS is a deliberately small web GIS, inspired by GratisGIS, for managing a commune's **own map data with its own attributes**.

Driving use cases:

1. **Waste containers.** Open the map (default view: Brenzikofen). In the layer tree on the left, open *Umwelt → Abfallcontainer* to show the containers. Add new containers, move them, edit their attributes, delete them, and attach photos.
2. **Neophytes.** Open *Umwelt → Neophyten* to show, draw, edit and delete polygons marking where neophytes were found.

Layers, their place in the tree and their attributes are defined in a **config file**, so adding a new layer means editing config, not code.

## 2. Goals, non-goals, anti-goals

**Goals**
- Show swisstopo base maps with config-defined vector layers on top.
- Layer tree (nested groups) with on/off toggles.
- Create, move or reshape, edit attributes of, and delete point, line and polygon features.
- Attach photos to features, view them and delete them.
- Attribute forms generated from config, with simple validation.
- Run as **one Docker container** with all data (features and photos) stored **on the server** in a mounted volume.

**Non-goals (for now)**
- Authentication and user management inside the app. Access control is handled in front of it: the app runs behind **Traefik with Authentik** (forward auth), so only authenticated users reach it. OIDC inside the app may come later, so the API must stay easy to put behind auth middleware.
- Mobile or phone layout, GPS positioning, camera capture. The app targets desktop screens of 14" and up.
- Import/export UI, printing, measuring, search, attribute-based styling, edit history or versioning, multiple communes or tenants.
- Simultaneous-edit conflict handling (last write wins).

**Anti-goals (failure even if it technically works)**
- Adding a layer or attribute requires touching code.
- Data is lost when the container is rebuilt or updated.
- Data ends up locked in a format other tools can't read. The GeoPackage must open cleanly in QGIS.
- It grows into a heavy stack (separate DB, map server, many services).

## 3. Constraints

- Web app, used in desktop browsers.
- Docker, one container (two at most). The chosen design uses one.
- Coordinates: Swiss LV95 (EPSG:2056) for storage and map display.
- Base maps: swisstopo's free WMTS (national map colour, national map grey, SWISSIMAGE aerial).
- Files (photos) are stored on the server, in the data volume, not in the browser or an external service.
- Runtime: Linux Docker host in production (x86-64), Docker Desktop on Windows for development.
- Reached only through Traefik + Authentik. The app itself listens on plain HTTP inside the Docker network. TLS and login are Traefik's and Authentik's job.
- No existing data to import. Layers start empty.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | One container: a TypeScript/Node server serves the front end and API. Features live in a single **GeoPackage** file. Photos are files in a folder next to it on a mounted volume. | Simplest to run and back up (copy one folder). The file opens in QGIS. Concurrent edits are last-write-wins, which is acceptable for a small team. |
| B | Two containers: the same app with **PostgreSQL/PostGIS**. | Better for many simultaneous editors, and QGIS can connect live. Costs an extra service, DB backups and more moving parts. |
| C (dropped) | Thin front end on GeoServer or QGIS Server (WFS-T). | Heavy to configure and operate. Contradicts "very simple". |

The user picked **A**, with the requirement that files are stored on the server. A later move to PostGIS should only touch the storage layer, not the front end or the API contract.

## 5. Design

### 5.1 Architecture

```
Browser (OpenLayers SPA)
   │  HTTP/JSON (GeoJSON in EPSG:2056)
   ▼
Node/TypeScript app (one container)
   ├─ serves static front end (built at image build time)
   ├─ /api/... REST endpoints
   ├─ storage module ──► /data/minigis.gpkg (one table per layer)
   └─ photo module   ──► /data/photos/...
Config: /config/minigis.yaml (mounted read-only)
```

Volumes: `/data` (read-write, persistent) and `/config` (read-only). A `docker-compose.yml` with one service is provided.

**Who edited what:** Authentik's forward-auth adds identity headers (e.g. `X-Authentik-Username`). When present, the server stores the value in `created_by` / `updated_by` on features and photos. When absent (local dev), it stores nothing. The header name is configurable. The app never relies on the header for access control.

### 5.2 Config file (`minigis.yaml`)

The config is the single source of truth for the map view, base maps and layers. Illustrative shape (the exact schema is left to the builder, but it must cover these concepts):

```yaml
app:
  title: "MiniGIS Brenzikofen"
map:
  # default view in EPSG:2056 (approximate; builder to verify against the commune boundary)
  center: [2613500, 1185100]
  zoom: 15            # or an extent [minx, miny, maxx, maxy]
basemaps:
  - id: farbe
    title: Landeskarte farbig
    layer: ch.swisstopo.pixelkarte-farbe
    default: true
  - id: grau
    title: Landeskarte grau
    layer: ch.swisstopo.pixelkarte-grau
  - id: luftbild
    title: Luftbild
    layer: ch.swisstopo.swissimage
tree:
  - group: Umwelt
    children:
      - layer: abfallcontainer
      - layer: neophyten
layers:
  abfallcontainer:
    title: Abfallcontainer
    geometry: point            # point | line | polygon
    photos: true
    style: { color: "#2e7d32", radius: 7 }
    label: nummer              # optional attribute shown as map label / list title
    attributes:
      - { name: nummer,  label: Nummer,      type: text,    required: true }
      - { name: typ,     label: Typ,         type: select,  options: [Glas, Alu/Blech, Altöl, Grüngut, Papier] }
      - { name: volumen, label: "Volumen (l)", type: integer }
      - { name: geleert, label: Letzte Leerung, type: date }
      - { name: bemerkung, label: Bemerkung, type: textarea }
  neophyten:
    title: Neophyten
    geometry: polygon
    photos: true
    style: { color: "#c62828", fill: "rgba(198,40,40,0.25)" }
    attributes:
      - { name: art,      label: Art,       type: select, options: [Drüsiges Springkraut, Kanadische Goldrute, Japanischer Staudenknöterich, Andere] }
      - { name: gefunden, label: Gefunden am, type: date, required: true }
      - { name: bekaempft, label: Bekämpft, type: boolean }
      - { name: bemerkung, label: Bemerkung, type: textarea }
```

Attribute types: `text`, `textarea`, `integer`, `number`, `date`, `boolean`, `select` (with `options`). Each attribute may set `required` and `default`.

The attribute values in the example are placeholders. The user will fill in the real ones.

**Schema sync at startup:** for each configured layer, create its GeoPackage table if it's missing (geometry column in EPSG:2056, plus `id`, `created_at`, `updated_at`, `created_by`, `updated_by`), and **add** columns for new attributes. Never drop or rename columns automatically. Removed attributes stay in the file and are just hidden. A config error, such as an unknown type or a layer referenced in the tree but not defined, stops startup with a clear message.

### 5.3 Storage

- One GeoPackage at `/data/minigis.gpkg`, with one feature table per layer (table name = layer id), registered properly (`gpkg_contents`, `gpkg_geometry_columns`, spatial index) so QGIS opens it without complaint.
- Written through GDAL/OGR via the Node bindings **`gdal-async`** (prebuilt binaries for Linux x64 and Windows x64). If those prove unworkable, fall back to `better-sqlite3` plus a hand-written GeoPackage geometry encoder, as long as `ogrinfo` and QGIS accept the file.
- Photos: `/data/photos/<layer>/<feature_id>/<uuid>.<ext>`, with a `photos` table in the same GeoPackage (`id`, `layer`, `feature_id`, `filename`, `content_type`, `size`, `created_at`). Deleting a feature deletes its photos.
- Accept JPEG, PNG and WebP (HEIC dropped: browsers cannot display it and the image library cannot decode it without extra codecs) up to a configurable size (default 15 MB). Generate a downscaled thumbnail at upload time for the gallery.
- Writes are serialised in-process (single worker or a lock) to avoid SQLite write contention. The GeoPackage uses WAL mode, so QGIS can **read** the live file safely. Editing the live file in QGIS while the app runs is not supported (edit a copy, or stop the app).

### 5.4 API (JSON, coordinates in EPSG:2056)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Map, base map, tree and layer definitions for the front end |
| GET | `/api/layers/{layer}/features` | All features as a GeoJSON FeatureCollection (optional `bbox`) |
| POST | `/api/layers/{layer}/features` | Create (GeoJSON Feature) and return the stored feature |
| PUT | `/api/layers/{layer}/features/{id}` | Replace geometry and/or attributes |
| DELETE | `/api/layers/{layer}/features/{id}` | Delete the feature and its photos |
| GET | `/api/layers/{layer}/features/{id}/photos` | List photo metadata |
| POST | `/api/layers/{layer}/features/{id}/photos` | Upload (multipart, one or more files) |
| GET | `/api/photos/{photo_id}` · `/api/photos/{photo_id}/thumb` | Serve the image or thumbnail |
| DELETE | `/api/photos/{photo_id}` | Delete a photo |

The server validates the geometry type against the layer and the attributes against the config (types, required, select options), and returns 422 with field-level messages. The data volume is expected to stay small (hundreds to low thousands of features per layer), so loading all features of a visible layer at once is fine.

### 5.5 Front end

- Single-page app: **OpenLayers** with **proj4** for EPSG:2056, swisstopo WMTS in the LV95 tile grid. **Vite + TypeScript + Svelte 5** for the UI pieces (tree, forms, gallery). Built in a multi-stage Docker build and served by the Node server.
- UI language: **German**.

Layout (desktop):

```
┌──────────────────────────────────────────────────────────────────────┐
│ MiniGIS Brenzikofen                          [Karte ▾ farbig|grau|Luftbild] │
├───────────────┬──────────────────────────────────────┬───────────────┤
│ Ebenen        │                                      │ Abfallcontainer│
│ ▾ Umwelt      │                                      │ Nummer [ A-12 ]│
│   ☑ Abfall-   │               MAP                    │ Typ    [Glas ▾]│
│     container ✎│                                      │ ...            │
│   ☐ Neophyten │   [+ Neu] [Verschieben/Form] [Löschen]│ Fotos: ▢ ▢ [+] │
│               │                                      │ [Speichern]    │
└───────────────┴──────────────────────────────────────┴───────────────┘
```

- **Tree (left):** nested groups (collapsible), a checkbox per layer for visibility, and a pencil icon to make that layer the **edit layer** (one at a time).
- **Map:** click a feature on any visible layer to select it. The right panel shows its attributes and photos read-only, with an **Edit** button when the layer is editable.
- **Editing tools** (shown when an edit layer is set): *Neu* (draw a point, line or polygon by layer type, then the attribute form opens), *Bearbeiten* (move points, drag vertices, translate the whole feature), *Löschen* (with confirmation). Escape cancels drawing.
- **Attribute panel (right):** form generated from config, client-side validation mirroring the server, Save/Cancel. Unsaved geometry changes are discarded on Cancel.
- **Photos:** thumbnail gallery in the panel, click for a full-size view, drag-and-drop or file picker to add, delete per photo.
- Errors from the server are shown inline, not as browser `alert()`s.

### 5.6 Deployment

- `Dockerfile` (multi-stage: build the front end, then the runtime image) and `docker-compose.yml` with one service, port 8080 inside the container, volumes for `/data` and `/config:ro`.
- **Production (Linux):** bind-mount `./data` on local disk (not a network share). Example Traefik labels (router, service, Authentik forward-auth middleware) are included in the compose file as commented examples. The app doesn't publish a host port in prod.
- **Development (Docker Desktop on Windows):** a `docker-compose.dev.yml` override publishes port 8080 and keeps `/data` in a **named Docker volume**. SQLite locking on Windows bind mounts is unreliable. Config is still bind-mounted from the repo so edits are easy.
- The repo ships an example `config/minigis.yaml` for Brenzikofen with the two layers above.
- Backup = copy `./data`.

### 5.7 Testing

- Backend: Vitest against a temporary GeoPackage, with API tests through Fastify's `inject`. Covers config validation, schema sync (including adding a column), feature CRUD per geometry type, attribute validation, photo upload/delete, and cascade on feature delete.
- Front end: Vitest unit tests for the config-driven form generation and validation. A Playwright smoke test that loads the app, toggles a layer, creates a point, saves it and sees it after a reload.
- Check that the produced `.gpkg` opens with `ogrinfo` (proxy for QGIS compatibility).

## 6. Decided by the user

- Own data, own attributes. Layers, tree and attributes come from a config file.
- Default area: commune of Brenzikofen, set in config.
- Use cases: waste containers (points with photos) and neophytes (polygons).
- No auth in the app. It runs behind Traefik + Authentik, so only authenticated users reach it. OIDC in the app maybe later.
- Production on Linux Docker, development on Docker Desktop for Windows.
- No existing data to import.
- Docker, one or at most two containers. Web app.
- Mostly used on screens of 14" and up.
- Approach A (one container, GeoPackage). Files stored on the server.
- Language: TypeScript, back end and front end.

## 7. Calls made by Claude (open to correction)

- swisstopo base maps; LV95 (EPSG:2056) throughout.
- Full TypeScript stack (the user chose TypeScript over Python): Node 22 + **Fastify** back end, **zod** schemas for the config and attribute validation shared by the server and browser, npm workspaces (`server`, `web`, `shared`), Svelte 5 + OpenLayers front end, `gdal-async` for GeoPackage, `sharp` for thumbnails.
- German UI.
- Line layers are supported too (cheap, and the config allows them), even though no use case needs them yet.
- Photos can be enabled per layer (`photos: true`) on any geometry type.
- Schema sync only adds columns and never drops them.
- Last write wins; no locking or edit history.
- Example attribute lists are placeholders until the user supplies real ones.
- Record the Authentik username as `created_by` / `updated_by` when the header is present.
- Dev uses a named Docker volume for data. Prod uses a bind mount on local disk.
- QGIS may read the live GeoPackage, but editing it live is unsupported.

## 8. Left to the builder

- Exact config schema syntax and validation library.
- Front-end structure and whether to use a small UI library.
- Thumbnail size and image library.
- Map styling details beyond the per-layer colour.

# MiniGIS

A small web GIS for a municipality (default: Brenzikofen, CH). Layers, attributes and the layer tree are defined in one YAML file. Users add, move, edit and delete points, lines and polygons in the browser and attach photos. The UI is German. It is designed for desktop screens (14" and larger).

- Stack: TypeScript monorepo (`shared`, `server` = Fastify + gdal-async + sharp, `web` = Vite + Svelte 5 + OpenLayers).
- Storage: one GeoPackage (`/data/minigis.gpkg`, WAL mode) plus photo files (`/data/photos/<layer>/<fid>/<uuid>.<ext>`, thumbnails `<uuid>.thumb.jpg`).
- All geometry is EPSG:2056 (LV95) in storage, API and map. Basemaps are swisstopo WMTS.
- No authentication in the app. Run it behind Traefik + Authentik. The identity header (`app.userHeader`) is stored in the `*_by` fields and never used for access control.
- One container, one process.

## Run (dev, Docker Desktop on Windows/macOS/Linux)

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
curl localhost:8080/api/health        # {"ok":true}
```

Open <http://localhost:8080>. The dev override publishes port 8080 and keeps data in the named volume `minigis-data` (bind mounts on Windows are unreliable for SQLite WAL). The config is mounted read-only from `./config`.

Edit `config/minigis.yaml`, then `docker compose ... restart`. Config errors are printed to the container log and the container exits.

### Local development without Docker

```sh
npm ci
npm run build
MINIGIS_CONFIG=config/minigis.yaml MINIGIS_DATA=./data node server/dist/main.js
```

`npm run dev` starts the server (tsx watch) and Vite; `npm test` runs the unit tests only.

### Smoke test (Playwright)

With the stack running on port 8080:

```sh
npm run e2e        # playwright test --trace off; set MINIGIS_URL to target another host
```

It creates a container `E2E-1` in the real data volume, reloads and selects it again. Delete the feature in the UI afterwards if the data matters. Browsers: `@playwright/test` is pinned to 1.63.0; run `npx playwright install chromium` once if no browser is installed.

## Run (prod, Linux + Traefik + Authentik)

1. Create empty `data/` and `config/` directories next to `docker-compose.yml`. The image runs as user `node` (uid 1000), so `chown 1000:1000 data config`. On first start, if `config/minigis.yaml` is missing, the app copies the bundled default there for you to edit; then restart. If the config folder is mounted read-only, the app logs a warning and runs with the built-in default.
2. In `docker-compose.yml` uncomment the Traefik labels (router rule `Host(\`minigis.example.ch\`)`, `entrypoints=websecure`, `tls=true`, `middlewares=authentik@docker`, `loadbalancer.server.port=8080`) and attach the service to the Traefik network.
3. `docker compose pull && docker compose up -d`. This uses the image `ghcr.io/majortwip/minigis:latest`, which GitHub Actions builds on every push to `main`. No port is published; Traefik is the only way in. To update later, run the same command again.

### Continuous integration

`.github/workflows/build_push.yml` runs on pull requests, pushes to `main`, and `v*` tags:

- **test**: `npm ci`, `npm run build`, `npm test`.
- **build-and-push-image** (only after the tests pass): builds the Docker image. On a pull request it only builds and pushes nothing. On `main` it pushes `ghcr.io/majortwip/minigis` with the tags `latest` and `sha-<short>`. A tag `v1.2.3` also pushes `1.2.3` and `1.2`, plus a build provenance attestation.

If the package is private, log in on the server once with `docker login ghcr.io` using a personal access token that has `read:packages`, or make the package public under the repository's *Packages* settings.

Authentik forwards the user name in `X-Authentik-Username`; change `app.userHeader` if your outpost uses another header.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINIGIS_CONFIG` | `/config/minigis.yaml` | config file |
| `MINIGIS_DATA` | `/data` | GeoPackage and photos |
| `PORT` | `8080` | listen port |

### Backup and QGIS

Back up the whole `./data` directory (GeoPackage and photos together).

The GeoPackage runs in SQLite WAL mode. The app checkpoints after every write, so `minigis.gpkg` on its own is a complete GeoPackage between edits, and you can copy just that file to open it in QGIS or another viewer. While an edit is being saved, newer changes can still sit in `minigis.gpkg-wal`. For a copy that is guaranteed consistent, stop the container first:

```sh
docker compose stop minigis
cp data/minigis.gpkg ~/minigis-$(date +%F).gpkg
docker compose start minigis
```

If you copy the file while the app runs, copy `minigis.gpkg-wal` along with it (same folder, same base name); SQLite merges it the next time the file is opened.

QGIS may open a copy of the file, or the live file read-only. Do not edit the live file in QGIS: the app holds the write lock, and QGIS edits would bypass validation and the photo bookkeeping.

### Config changes between restarts

Schema sync only creates tables and adds columns. It never drops or renames anything. Removing an attribute from the config hides it (data stays in the file); adding one creates an empty column; new layers get a new table.

## Config reference (`config/minigis.yaml`)

```yaml
app:
  title: "MiniGIS Brenzikofen"
  userHeader: X-Authentik-Username
  maxPhotoMb: 15
map:
  center: [2613500, 1185100]
  zoom: 15
basemaps:
  - { id: farbe, title: Landeskarte farbig, layer: ch.swisstopo.pixelkarte-farbe, default: true }
tree:
  - group: Umwelt
    children:
      - layer: abfallcontainer
layers:
  abfallcontainer:
    title: Abfallcontainer
    geometry: point
    photos: true
    style: { color: "#2e7d32", radius: 7 }
    label: nummer
    attributes:
      - { name: nummer, label: Nummer, type: text, required: true }
      - { name: typ, label: Typ, type: select, options: [Glas, Papier], default: Glas }
```

### `app` (optional, default `{title: MiniGIS}`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string | required if `app` is given (`MiniGIS` if omitted entirely) | header title |
| `userHeader` | string | `X-Authentik-Username` | request header stored in `created_by` / `updated_by` |
| `maxPhotoMb` | number > 0 | `15` | maximum upload size per photo |

### `map`

| Key | Type | Meaning |
| --- | --- | --- |
| `center` | `[x, y]` numbers | initial view centre in EPSG:2056 |
| `zoom` | number | initial zoom |

### `basemaps` (list)

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | identifier |
| `title` | string | label in the switcher |
| `layer` | string | swisstopo WMTS layer id (e.g. `ch.swisstopo.pixelkarte-farbe`) |
| `default` | boolean, optional | initially shown (first entry if none is marked) |

### `tree` (list of nodes)

A node is either `{ group: <name>, children: [<nodes>] }` (groups nest) or `{ layer: <layer id> }`. Every referenced layer must exist under `layers`.

### `layers` (map of layer id to layer)

Layer ids and attribute names match `^[a-z][a-z0-9_]*$`.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string | | name in the tree |
| `geometry` | `point` \| `line` \| `polygon` | | geometry type |
| `photos` | boolean | `false` | allow photo attachments (JPEG, PNG, WebP; others get 415) |
| `style.color` | CSS colour | | stroke / point colour |
| `style.fill` | CSS colour, optional | | polygon fill |
| `style.radius` | number > 0, optional | | point radius in px |
| `style.symbolBy` | attribute name, optional | | point layers: a `select` attribute whose value picks the symbol |
| `style.symbols` | map value → `{ shape, color }`, optional | | symbol per value; `shape` is one of `circle`, `square`, `diamond`, `triangle`, `triangle-down`, `pentagon`, `hexagon`, `star`. Values without an entry are drawn as a circle in `style.color`. The layer tree shows a legend while the layer is visible. |
| `label` | attribute name, optional | | attribute shown as map label and panel title |
| `attributes` | list | | see below |

### Attributes

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | string | column name; must not be one of `fid`, `geom`, `created_at`, `updated_at`, `created_by`, `updated_by`; unique per layer |
| `label` | string, optional | form label (defaults to `name`) |
| `type` | see below | value type |
| `required` | boolean, optional | empty value is rejected (HTTP 422); an empty optional field is stored as NULL |
| `default` | string \| number \| boolean, optional | initial form value |
| `options` | list of strings | required and non-empty for `select`, otherwise unused |

Attribute types: `text` (single line), `textarea` (multi-line), `integer`, `number`, `date` (`YYYY-MM-DD`), `boolean` (checkbox), `select` (one of `options`).

Every feature table also has `fid`, `geom`, `created_at`, `updated_at` (ISO-8601 UTC) and `created_by`, `updated_by`.

## API (summary)

`GET /api/health`, `GET /api/config`, feature CRUD under `/api/layers/:layer/features`, photos under the feature. Validation errors: 422 `{ "errors": { "<field>": "<message>" } }`; unknown layer or feature: 404.

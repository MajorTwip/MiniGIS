import TileLayer from 'ol/layer/Tile';
import LayerGroup from 'ol/layer/Group';
import type BaseLayer from 'ol/layer/Base';
import WMTS from 'ol/source/WMTS';
import WMTSTileGrid from 'ol/tilegrid/WMTS';
import { apply } from 'ol-mapbox-style';
import type { BasemapDef } from '@minigis/shared';
import { registerLv95 } from './projection';

const ORIGIN = [2420000, 1350000];
export const SWISS_EXTENT = [2420000, 1030000, 2900000, 1350000];
const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650, 500, 250,
  100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];
const URL_TEMPLATE =
  'https://wmts.geo.admin.ch/1.0.0/{Layer}/default/current/2056/{TileMatrix}/{TileCol}/{TileRow}.jpeg';

/** swisstopo WMTS raster layer in LV95. */
export function createWmtsLayer(def: { layer: string }): TileLayer<WMTS> {
  const projection = registerLv95();
  return new TileLayer({
    extent: SWISS_EXTENT,
    source: new WMTS({
      url: URL_TEMPLATE,
      layer: def.layer,
      matrixSet: '2056',
      format: 'image/jpeg',
      projection,
      requestEncoding: 'REST',
      style: 'default',
      attributions: '© swisstopo',
      tileGrid: new WMTSTileGrid({
        origin: ORIGIN,
        resolutions: RESOLUTIONS,
        matrixIds: RESOLUTIONS.map((_, i) => String(i)),
      }),
    }),
  });
}

/**
 * Vector tile base map from a Mapbox/MapLibre style URL (e.g. swisstopo's light base map).
 * The tiles are Web Mercator; OpenLayers reprojects them into the LV95 view.
 * The style is fetched the first time the group is made visible, so unused base maps
 * cost nothing.
 */
export function createVectorBasemap(
  def: { style: string },
  onError?: (message: string) => void,
  load: typeof apply = apply,
): LayerGroup {
  const group = new LayerGroup({ visible: false });
  let requested = false;
  const ensureLoaded = () => {
    if (requested || !group.getVisible()) return;
    requested = true;
    load(group, def.style).catch(() => {
      requested = false; // allow a retry the next time the map is selected
      onError?.('Hintergrundkarte konnte nicht geladen werden');
    });
  };
  group.on('change:visible', ensureLoaded);
  return group;
}

/** Base map layer for a config entry: WMTS raster (`layer`) or vector tiles (`style`). */
export function createBasemapLayer(def: BasemapDef | { layer: string }, onError?: (message: string) => void): BaseLayer {
  if ('style' in def) return createVectorBasemap(def, onError);
  return createWmtsLayer(def);
}

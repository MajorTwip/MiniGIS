import TileLayer from 'ol/layer/Tile';
import WMTS from 'ol/source/WMTS';
import WMTSTileGrid from 'ol/tilegrid/WMTS';
import { registerLv95 } from './projection';

const ORIGIN = [2420000, 1350000];
export const SWISS_EXTENT = [2420000, 1030000, 2900000, 1350000];
const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650, 500, 250,
  100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];
const URL_TEMPLATE =
  'https://wmts.geo.admin.ch/1.0.0/{Layer}/default/current/2056/{TileMatrix}/{TileCol}/{TileRow}.jpeg';

export function createBasemapLayer(def: { layer: string }): TileLayer<WMTS> {
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

import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection, type Projection } from 'ol/proj';

const LV95 =
  '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs';

/** Registers EPSG:2056 (LV95) with proj4 and OpenLayers; idempotent. */
export function registerLv95(): Projection {
  proj4.defs('EPSG:2056', LV95);
  register(proj4);
  const p = getProjection('EPSG:2056');
  if (!p) throw new Error('EPSG:2056 konnte nicht registriert werden');
  return p;
}

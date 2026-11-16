import { describe, expect, it } from 'vitest';
import { createBasemapLayer } from '../src/map/basemaps';
import { registerLv95 } from '../src/map/projection';

describe('basemaps', () => {
  it('builds a WMTS tile URL for the layer in EPSG:2056', () => {
    const layer = createBasemapLayer({ layer: 'ch.swisstopo.pixelkarte-farbe' });
    const source = layer.getSource()!;
    const url = source.getTileUrlFunction()([20, 1, 1], 1, registerLv95());
    expect(url).toContain('/ch.swisstopo.pixelkarte-farbe/default/current/2056/20/');
  });
});

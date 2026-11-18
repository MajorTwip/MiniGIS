import { describe, expect, it, vi } from 'vitest';
import TileLayer from 'ol/layer/Tile';
import LayerGroup from 'ol/layer/Group';
import { createBasemapLayer, createVectorBasemap } from '../src/map/basemaps';
import { registerLv95 } from '../src/map/projection';

describe('basemaps', () => {
  it('builds a WMTS tile URL for the layer in EPSG:2056', () => {
    const layer = createBasemapLayer({ layer: 'ch.swisstopo.pixelkarte-farbe' }) as TileLayer<any>;
    expect(layer).toBeInstanceOf(TileLayer);
    const source = layer.getSource()!;
    const url = source.getTileUrlFunction()([20, 1, 1], 1, registerLv95());
    expect(url).toContain('/ch.swisstopo.pixelkarte-farbe/default/current/2056/20/');
  });

  it('a style entry gives a hidden layer group', () => {
    const layer = createBasemapLayer({ id: 'v', title: 'V', style: 'https://example.org/style.json' });
    expect(layer).toBeInstanceOf(LayerGroup);
    expect(layer.getVisible()).toBe(false);
  });

  it('loads the vector style only once, the first time it is shown', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const group = createVectorBasemap({ style: 'https://example.org/style.json' }, undefined, load);
    expect(load).not.toHaveBeenCalled();
    group.setVisible(true);
    group.setVisible(false);
    group.setVisible(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(group, 'https://example.org/style.json');
  });

  it('reports a style load failure and retries on the next show', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    const onError = vi.fn();
    const group = createVectorBasemap({ style: 'https://example.org/style.json' }, onError, load);
    group.setVisible(true);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Hintergrundkarte konnte nicht geladen werden'));
    group.setVisible(false);
    group.setVisible(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

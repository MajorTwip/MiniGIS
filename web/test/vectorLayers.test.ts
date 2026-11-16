import { describe, expect, it } from 'vitest';
import type { LayerDef } from '@minigis/shared';
import { createVectorLayer, styleFor } from '../src/map/vectorLayers';

const point: LayerDef = {
  title: 'Abfallcontainer',
  geometry: 'point',
  photos: true,
  style: { color: '#2e7d32', radius: 7 },
  label: 'nummer',
  attributes: [{ name: 'nummer', type: 'text' }],
};
const polygon: LayerDef = {
  title: 'Neophyten',
  geometry: 'polygon',
  photos: true,
  style: { color: '#c62828', fill: 'rgba(198,40,40,0.25)' },
  attributes: [],
};

describe('styleFor', () => {
  it('draws point layers as circles with the configured radius and colour', () => {
    const image = styleFor(point, false).getImage() as any;
    expect(image.getRadius()).toBe(7);
    expect(image.getFill().getColor()).toBe('#2e7d32');
  });

  it('defaults the point radius to 6', () => {
    const def = { ...point, style: { color: '#000' } };
    expect((styleFor(def, false).getImage() as any).getRadius()).toBe(6);
  });

  it('makes the selected style thicker with a white halo', () => {
    const normal = (styleFor(point, false).getImage() as any).getStroke();
    const selected = (styleFor(point, true).getImage() as any).getStroke();
    expect(selected.getWidth()).toBeGreaterThan(normal.getWidth());
    expect(selected.getColor()).toBe('#ffffff');
  });

  it('thickens polygon outlines when selected and keeps the fill', () => {
    const normal = styleFor(polygon, false);
    const selected = styleFor(polygon, true);
    expect(selected.getStroke()!.getWidth()).toBeGreaterThan(normal.getStroke()!.getWidth()!);
    expect(selected.getFill()!.getColor()).toBe('rgba(198,40,40,0.25)');
  });
});

describe('createVectorLayer', () => {
  it('loads from the API in EPSG:2056, is hidden and tagged with its id', () => {
    const layer = createVectorLayer('abfallcontainer', point);
    expect(layer.get('layerId')).toBe('abfallcontainer');
    expect(layer.getVisible()).toBe(false);
    expect(layer.getSource()!.getUrl()).toBe('/api/layers/abfallcontainer/features');
  });
});

describe('createVectorLayer load errors', () => {
  it('reports a German message when features fail to load', () => {
    const messages: string[] = [];
    const layer = createVectorLayer('abfallcontainer', point, (m) => messages.push(m));
    layer.getSource()!.dispatchEvent('featuresloaderror');
    expect(messages).toEqual(['Ebene Abfallcontainer konnte nicht geladen werden']);
  });
});

import { describe, expect, it } from 'vitest';
import type { LayerDef } from '@minigis/shared';
import Feature from 'ol/Feature';
import { createVectorLayer, legendEntries, styleFor, symbolFor } from '../src/map/vectorLayers';

const point: LayerDef = {
  title: 'Abfallcontainer',
  geometry: 'point',
  photos: true,
  snapToRoads: false,
  style: { color: '#2e7d32', radius: 7 },
  label: 'nummer',
  attributes: [{ name: 'nummer', type: 'text' }],
};
const polygon: LayerDef = {
  title: 'Neophyten',
  geometry: 'polygon',
  photos: true,
  snapToRoads: false,
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

const typed: LayerDef = {
  ...point,
  style: {
    color: '#2e7d32',
    radius: 7,
    symbolBy: 'typ',
    symbols: {
      Glas: { shape: 'circle', color: '#2e7d32' },
      Papier: { shape: 'square', color: '#1e88e5' },
      Neophyten: { shape: 'star', color: '#d81b60' },
    },
  },
  attributes: [
    { name: 'nummer', type: 'text' },
    { name: 'typ', type: 'select', options: ['Glas', 'Papier', 'Neophyten', 'Schlamm'] },
  ],
};
const withTyp = (typ: string | null) => new Feature({ typ });

describe('symbols by attribute', () => {
  it('symbolFor picks the configured symbol for the value', () => {
    expect(symbolFor(typed, 'Papier')).toEqual({ shape: 'square', color: '#1e88e5' });
  });

  it('symbolFor falls back to a circle in the layer colour', () => {
    expect(symbolFor(typed, 'Schlamm')).toEqual({ shape: 'circle', color: '#2e7d32' });
    expect(symbolFor(typed, null)).toEqual({ shape: 'circle', color: '#2e7d32' });
    expect(symbolFor(point, 'x')).toEqual({ shape: 'circle', color: '#2e7d32' });
  });

  it('draws a square for Papier in its colour', () => {
    const image = styleFor(typed, false, withTyp('Papier')).getImage() as any;
    expect(image.getPoints()).toBe(4);
    expect(image.getFill().getColor()).toBe('#1e88e5');
  });

  it('draws a star with an inner radius for Neophyten', () => {
    const image = styleFor(typed, false, withTyp('Neophyten')).getImage() as any;
    expect(image.getPoints()).toBe(5);
    expect(image.getRadius2()).toBeLessThan(image.getRadius());
  });

  it('keeps circles as circles and grows symbols when selected', () => {
    const normal = styleFor(typed, false, withTyp('Glas')).getImage() as any;
    const selected = styleFor(typed, true, withTyp('Glas')).getImage() as any;
    expect(normal.getRadius()).toBe(7);
    expect(selected.getRadius()).toBeGreaterThan(7);
  });

  it('legendEntries lists every option in order with its symbol', () => {
    expect(legendEntries(typed).map((e) => [e.value, e.symbol.shape])).toEqual([
      ['Glas', 'circle'],
      ['Papier', 'square'],
      ['Neophyten', 'star'],
      ['Schlamm', 'circle'],
    ]);
    expect(legendEntries(point)).toEqual([]);
  });
});

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import type Feature from 'ol/Feature';
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import type ImageStyle from 'ol/style/Image';
import type { LayerDef, SymbolDef, SymbolShape } from '@minigis/shared';

const HALO = '#ffffff';

/** Symbol for a feature's value of `style.symbolBy`; a circle in the layer colour otherwise. */
export function symbolFor(def: LayerDef, value: unknown): SymbolDef {
  const configured =
    def.style.symbolBy !== undefined && typeof value === 'string' ? def.style.symbols?.[value] : undefined;
  return configured ?? { shape: 'circle', color: def.style.color };
}

/** One legend row per option of the `symbolBy` attribute, in option order. */
export function legendEntries(def: LayerDef): { value: string; symbol: SymbolDef }[] {
  if (def.geometry !== 'point' || def.style.symbolBy === undefined) return [];
  const attr = def.attributes.find((a) => a.name === def.style.symbolBy);
  return (attr?.options ?? []).map((value) => ({ value, symbol: symbolFor(def, value) }));
}

// Size factors keep the different shapes visually about as large as the circle.
const SHAPES: Record<Exclude<SymbolShape, 'circle'>, { points: number; scale: number; angle: number; inner?: number }> = {
  square: { points: 4, scale: 1.2, angle: Math.PI / 4 },
  diamond: { points: 4, scale: 1.3, angle: 0 },
  triangle: { points: 3, scale: 1.35, angle: 0 },
  'triangle-down': { points: 3, scale: 1.35, angle: Math.PI },
  pentagon: { points: 5, scale: 1.15, angle: 0 },
  hexagon: { points: 6, scale: 1.1, angle: 0 },
  star: { points: 5, scale: 1.45, angle: 0, inner: 0.6 },
};

/** Point symbol image; also used to draw legend swatches. */
export function symbolImage(symbol: SymbolDef, radius: number, selected: boolean): ImageStyle {
  const fill = new Fill({ color: symbol.color });
  const stroke = new Stroke({ color: HALO, width: selected ? 4 : 1.5 });
  if (symbol.shape === 'circle') return new CircleStyle({ radius, fill, stroke });
  const s = SHAPES[symbol.shape];
  return new RegularShape({
    points: s.points,
    radius: radius * s.scale,
    radius2: s.inner !== undefined ? radius * s.inner : undefined,
    angle: s.angle,
    fill,
    stroke,
  });
}

/** Style for a layer; pass `feature` to add its label text. */
export function styleFor(def: LayerDef, selected: boolean, feature?: Feature): Style {
  const { color, radius } = def.style;
  const fill = new Fill({ color: def.style.fill ?? color });
  let style: Style;
  if (def.geometry === 'point') {
    const symbol = symbolFor(def, def.style.symbolBy ? feature?.get(def.style.symbolBy) : undefined);
    style = new Style({ image: symbolImage(symbol, (radius ?? 6) + (selected ? 2 : 0), selected) });
  } else {
    style = new Style({
      stroke: new Stroke({ color, width: selected ? 4 : 2 }),
      fill: def.geometry === 'polygon' ? fill : undefined,
    });
  }
  if (def.label && feature) {
    const value = feature.get(def.label);
    if (value !== null && value !== undefined && value !== '') {
      style.setText(
        new Text({
          text: String(value),
          font: '12px system-ui, sans-serif',
          offsetY: def.geometry === 'point' ? -((radius ?? 6) + 10) : 0,
          fill: new Fill({ color: '#222' }),
          stroke: new Stroke({ color: HALO, width: 3 }),
        }),
      );
    }
  }
  return style;
}

export function createVectorLayer(
  id: string,
  def: LayerDef,
  onLoadError?: (message: string) => void,
): VectorLayer<VectorSource<Feature>> {
  const layer = new VectorLayer<VectorSource<Feature>>({
    visible: false,
    source: new VectorSource<Feature>({
      url: `/api/layers/${encodeURIComponent(id)}/features`,
      format: new GeoJSON<Feature>({ dataProjection: 'EPSG:2056', featureProjection: 'EPSG:2056' }),
    }),
    style: (feature) => styleFor(def, false, feature as Feature),
  });
  layer.getSource()!.on('featuresloaderror', () => onLoadError?.(`Ebene ${def.title} konnte nicht geladen werden`));
  layer.set('layerId', id);
  return layer;
}

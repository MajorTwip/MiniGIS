import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import type Feature from 'ol/Feature';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';
import type { LayerDef } from '@minigis/shared';

const HALO = '#ffffff';

/** Style for a layer; pass `feature` to add its label text. */
export function styleFor(def: LayerDef, selected: boolean, feature?: Feature): Style {
  const { color, radius } = def.style;
  const fill = new Fill({ color: def.style.fill ?? color });
  let style: Style;
  if (def.geometry === 'point') {
    style = new Style({
      image: new CircleStyle({
        radius: (radius ?? 6) + (selected ? 2 : 0),
        fill: new Fill({ color }),
        stroke: new Stroke({ color: HALO, width: selected ? 4 : 1.5 }),
      }),
    });
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

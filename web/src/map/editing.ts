import type Map from 'ol/Map';
import type VectorLayer from 'ol/layer/Vector';
import VectorLayerImpl from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Collection from 'ol/Collection';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Snap from 'ol/interaction/Snap';
import type Interaction from 'ol/interaction/Interaction';
import type { Geometry } from 'ol/geom';
import type { Geometry as GeoJSONGeometry } from 'geojson';
import type { GeometryType } from '@minigis/shared';
import type { ApiFeature } from '../api';

const format = new GeoJSON<Feature>({ dataProjection: 'EPSG:2056', featureProjection: 'EPSG:2056' });

const DRAW_TYPE = { point: 'Point', line: 'LineString', polygon: 'Polygon' } as const;

/** OL geometry → GeoJSON geometry for the API (LV95 in and out). */
export function toGeoJSONGeometry(geom: Geometry): GeoJSONGeometry {
  return format.writeGeometryObject(geom) as GeoJSONGeometry;
}

/** API GeoJSON feature → OL feature (id = fid). */
export function readApiFeature(json: ApiFeature): Feature {
  return format.readFeature(json) as Feature;
}

/**
 * Map interactions for one edit layer: drawing a new geometry and modifying
 * (vertices + translate) an existing feature. Only one operation at a time.
 */
export class EditController {
  private interactions: Interaction[] = [];
  /** Shows a finished sketch until the new feature is saved or cancelled. */
  private sketch: VectorLayer<VectorSource<Feature>>;
  private modified: { feature: Feature; original: Geometry | undefined } | null = null;
  /** Geometries to snap to while drawing or modifying; null = no snapping. */
  private snapSource: VectorSource<Feature> | null = null;
  private snap: Snap | null = null;

  constructor(
    private map: Map,
    private layer: VectorLayer<VectorSource<Feature>>,
    private geometryType: GeometryType,
  ) {
    this.sketch = new VectorLayerImpl({ source: new VectorSource<Feature>(), style: layer.getStyle() });
  }

  /** Draw one geometry; it stays visible on the map until `stop()` or `cancel()`. */
  startDraw(onDone: (geom: Geometry) => void): void {
    this.stop();
    const source = this.sketch.getSource()!;
    this.map.addLayer(this.sketch);
    const draw = new Draw({ type: DRAW_TYPE[this.geometryType], source });
    draw.on('drawend', (e) => {
      // Remove after the current event: the double-click that finishes a line or
      // polygon must still be swallowed by Draw, not zoom the map.
      setTimeout(() => {
        this.remove(draw);
        this.updateSnap();
      });
      onDone(e.feature.getGeometry()!);
    });
    this.add(draw);
    this.updateSnap();
  }

  /** Move vertices or the whole feature; `cancel()` restores the original geometry. */
  startModify(feature: Feature): void {
    this.stop();
    this.modified = { feature, original: feature.getGeometry()?.clone() };
    const features = new Collection([feature]);
    // Translate first so Modify (added later, handled first) wins near vertices and edges.
    this.add(new Translate({ features, layers: [this.layer] }));
    this.add(new Modify({ features }));
    this.updateSnap();
  }

  /**
   * Snap vertices to the features of `source` while drawing or modifying, or turn
   * snapping off with null. Takes effect immediately, also during an operation.
   */
  setSnapSource(source: VectorSource<Feature> | null): void {
    this.snapSource = source;
    this.updateSnap();
  }

  /** True while a Snap interaction is active on the map. */
  get snapping(): boolean {
    return this.snap !== null;
  }

  /** True while a draw or modify operation is running. */
  get active(): boolean {
    return this.interactions.length > 0;
  }

  /** Snap must be the last interaction added so it sees pointer events first. */
  private updateSnap(): void {
    if (this.snap) {
      this.map.removeInteraction(this.snap);
      this.snap = null;
    }
    if (this.snapSource && this.interactions.length > 0) {
      this.snap = new Snap({ source: this.snapSource });
      this.map.addInteraction(this.snap);
    }
  }

  /** Abort the current operation and discard geometry changes. */
  cancel(): void {
    if (this.modified) this.modified.feature.setGeometry(this.modified.original);
    this.stop();
  }

  /** End the current operation, keeping geometry changes. */
  stop(): void {
    this.removeInteractions();
    this.modified = null;
    this.sketch.getSource()!.clear();
    this.map.removeLayer(this.sketch);
  }

  private add(interaction: Interaction): void {
    this.interactions.push(interaction);
    this.map.addInteraction(interaction);
  }

  private remove(interaction: Interaction): void {
    this.map.removeInteraction(interaction);
    this.interactions = this.interactions.filter((i) => i !== interaction);
  }

  private removeInteractions(): void {
    for (const i of this.interactions) this.map.removeInteraction(i);
    this.interactions = [];
    this.updateSnap();
  }
}

import { describe, expect, it } from 'vitest';
import type Map from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { LineString } from 'ol/geom';
import Snap from 'ol/interaction/Snap';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import type Interaction from 'ol/interaction/Interaction';
import { EditController } from '../src/map/editing';

/** Records the interaction stack like ol/Map does (last added = handled first). */
function fakeMap() {
  const interactions: Interaction[] = [];
  const map = {
    interactions,
    addInteraction: (i: Interaction) => interactions.push(i),
    removeInteraction: (i: Interaction) => {
      const n = interactions.indexOf(i);
      if (n >= 0) interactions.splice(n, 1);
    },
    addLayer: () => {},
    removeLayer: () => {},
  };
  return map;
}

function setup() {
  const map = fakeMap();
  const layer = new VectorLayer({ source: new VectorSource<Feature>() });
  const ctrl = new EditController(map as unknown as Map, layer, 'line');
  const roads = new VectorSource<Feature>();
  return { map, ctrl, roads };
}

describe('EditController snapping', () => {
  it('adds Snap after Draw while drawing with a snap source', () => {
    const { map, ctrl, roads } = setup();
    ctrl.setSnapSource(roads);
    expect(map.interactions).toHaveLength(0); // nothing to snap while idle
    ctrl.startDraw(() => {});
    expect(map.interactions[0]).toBeInstanceOf(Draw);
    expect(map.interactions.at(-1)).toBeInstanceOf(Snap);
    expect(ctrl.snapping).toBe(true);
  });

  it('can be switched off and on during an operation', () => {
    const { map, ctrl, roads } = setup();
    ctrl.startDraw(() => {});
    expect(map.interactions.some((i) => i instanceof Snap)).toBe(false);
    ctrl.setSnapSource(roads);
    expect(map.interactions.at(-1)).toBeInstanceOf(Snap);
    ctrl.setSnapSource(null);
    expect(map.interactions.some((i) => i instanceof Snap)).toBe(false);
    expect(map.interactions).toHaveLength(1);
  });

  it('snaps while modifying and removes Snap when the operation ends', () => {
    const { map, ctrl, roads } = setup();
    ctrl.setSnapSource(roads);
    const f = new Feature(new LineString([[0, 0], [1, 1]]));
    ctrl.startModify(f);
    expect(map.interactions.at(-2)).toBeInstanceOf(Modify);
    expect(map.interactions.at(-1)).toBeInstanceOf(Snap);
    ctrl.cancel();
    expect(map.interactions).toHaveLength(0);
    expect(ctrl.snapping).toBe(false);
  });
});

<script lang="ts">
  import { onMount } from 'svelte';
  import Map from 'ol/Map';
  import View from 'ol/View';
  import type TileLayer from 'ol/layer/Tile';
  import { registerLv95 } from './map/projection';
  import { createBasemapLayer } from './map/basemaps';
  import { api } from './api';
  import type Feature from 'ol/Feature';
  import type { Geometry } from 'ol/geom';
  import type { AppConfig, AttributeValue } from '@minigis/shared';
  import { createVectorLayer, styleFor } from './map/vectorLayers';
  import { EditController, readApiFeature, toGeoJSONGeometry } from './map/editing';
  import { initialFormValues } from './form';
  import BasemapSwitcher from './components/BasemapSwitcher.svelte';
  import LayerTree from './components/LayerTree.svelte';
  import FeaturePanel from './components/FeaturePanel.svelte';
  import EditToolbar from './components/EditToolbar.svelte';
  import AttributeForm from './components/AttributeForm.svelte';
  import PhotoGallery from './components/PhotoGallery.svelte';

  type EditState =
    | { mode: 'draw' }
    | { mode: 'create'; geometry: Geometry }
    | { mode: 'update'; feature: Feature };

  let mapEl: HTMLElement;
  let config = $state<AppConfig | null>(null);
  let error = $state<string | null>(null);
  let loadErrors = $state<string[]>([]);
  let saving = false;
  let activeBasemap = $state('');
  let selection = $state.raw<{ layerId: string; feature: Feature } | null>(null);
  let visible = $state(new Set<string>());
  let editLayer = $state<string | null>(null);
  let edit = $state.raw<EditState | null>(null);
  let controller: EditController | null = null;
  let map: Map | null = null;
  const vectorLayers = new globalThis.Map<string, ReturnType<typeof createVectorLayer>>();
  const baseLayers = new globalThis.Map<string, TileLayer<any>>();

  function selectBasemap(id: string) {
    activeBasemap = id;
    for (const [lid, layer] of baseLayers) layer.setVisible(lid === id);
  }

  function clearSelection() {
    if (selection) selection.feature.setStyle(null);
    selection = null;
  }

  function select(layerId: string, feature: Feature) {
    clearSelection();
    const def = config!.layers[layerId];
    feature.setStyle((f) => styleFor(def, true, f as Feature));
    selection = { layerId, feature };
  }

  function setEditLayer(id: string | null) {
    cancelEdit();
    editLayer = id;
    controller = id ? new EditController(map!, vectorLayers.get(id)!, config!.layers[id].geometry) : null;
  }

  function cancelEdit() {
    if (saving) return; // a save is in flight; its result decides what happens next
    controller?.cancel();
    edit = null;
  }

  function startNew() {
    cancelEdit();
    clearSelection();
    edit = { mode: 'draw' };
    controller!.startDraw((geometry) => (edit = { mode: 'create', geometry }));
  }

  function startEdit() {
    if (!selection || selection.layerId !== editLayer) return;
    cancelEdit();
    edit = { mode: 'update', feature: selection.feature };
    controller!.startModify(selection.feature);
  }

  async function saveEdit(values: Record<string, AttributeValue>) {
    if (!edit || edit.mode === 'draw' || !editLayer) return;
    const layerId = editLayer;
    const source = vectorLayers.get(layerId)!.getSource()!;
    const old = edit.mode === 'update' ? edit.feature : null;
    const geometry = toGeoJSONGeometry(edit.mode === 'update' ? edit.feature.getGeometry()! : edit.geometry);
    const ctrl = controller;
    saving = true;
    let saved;
    try {
      saved = old
        ? await api.updateFeature(layerId, old.getId() as number, { geometry, properties: values })
        : await api.createFeature(layerId, { geometry, properties: values });
    } finally {
      saving = false;
    }
    // Replace the edited feature with the server's version so the panel shows fresh values.
    ctrl?.stop();
    edit = null;
    clearSelection();
    if (old) source.removeFeature(old);
    const feature = readApiFeature(saved);
    source.addFeature(feature);
    if (visible.has(layerId)) select(layerId, feature);
  }

  async function deleteSelected() {
    if (!selection) return;
    const { layerId, feature } = selection;
    await api.deleteFeature(layerId, feature.getId() as number);
    clearSelection();
    vectorLayers.get(layerId)!.getSource()!.removeFeature(feature);
  }

  function toggleLayer(id: string) {
    const next = new Set(visible);
    if (next.has(id)) {
      next.delete(id);
      if (editLayer === id) setEditLayer(null);
      if (selection?.layerId === id) clearSelection();
    } else {
      next.add(id);
    }
    visible = next;
    vectorLayers.get(id)?.setVisible(next.has(id));
  }

  onMount(() => {
    init();
    return () => {
      cancelEdit();
      clearSelection();
      map?.setTarget(undefined);
      map = null;
    };
  });

  async function init() {
    try {
      config = await api.getConfig();
    } catch {
      error = 'Konfiguration konnte nicht geladen werden';
      return;
    }
    const projection = registerLv95();
    for (const b of config.basemaps) {
      const layer = createBasemapLayer(b);
      baseLayers.set(b.id, layer);
    }
    for (const [id, def] of Object.entries(config.layers)) {
      vectorLayers.set(id, createVectorLayer(id, def, (m) => {
        if (!loadErrors.includes(m)) loadErrors = [...loadErrors, m];
      }));
    }
    map = new Map({
      target: mapEl,
      layers: [...baseLayers.values(), ...vectorLayers.values()],
      view: new View({ projection, center: config.map.center, zoom: config.map.zoom }),
    });
    // singleclick fires 250 ms after the click, so remember whether the click
    // itself happened while editing (e.g. the click that placed a new point).
    let clickWhileEditing = false;
    map.on('click', () => (clickWhileEditing = !!edit));
    map.on('singleclick', (e) => {
      if (edit || clickWhileEditing) return; // clicks belong to the edit interactions
      const hit = map!.forEachFeatureAtPixel(
        e.pixel,
        (feature, layer) => ({ feature: feature as Feature, layerId: layer?.get('layerId') as string }),
        { layerFilter: (l) => !!l.get('layerId') && l.getVisible() },
      );
      if (hit) select(hit.layerId, hit.feature);
      else clearSelection();
    });
    selectBasemap((config.basemaps.find((b) => b.default) ?? config.basemaps[0]).id);
  }
</script>

<div class="app">
  <header>
    <h1>{config?.app.title ?? 'MiniGIS'}</h1>
    {#if config}
      <BasemapSwitcher basemaps={config.basemaps} active={activeBasemap} onchange={selectBasemap} />
    {/if}
  </header>
  <div class="body">
    <aside class="sidebar" data-slot="sidebar">
      {#if error}<p class="error">{error}</p>{/if}
      {#each loadErrors as msg}<p class="error" role="alert">{msg}</p>{/each}
      {#if config}
        <LayerTree
          tree={config.tree}
          layers={config.layers}
          {visible}
          {editLayer}
          ontoggle={toggleLayer}
          onsetEdit={setEditLayer}
        />
      {/if}
    </aside>
    <div class="mapwrap">
      <main bind:this={mapEl} class="map"></main>
      {#if config && editLayer}
        <EditToolbar
          layerTitle={config.layers[editLayer].title}
          mode={edit?.mode ?? null}
          hasSelection={selection?.layerId === editLayer}
          onnew={startNew}
          onedit={startEdit}
          ondelete={deleteSelected}
          oncancel={cancelEdit}
        />
      {/if}
    </div>
    {#if config && editLayer && edit && edit.mode !== 'draw'}
      {@const def = config.layers[editLayer]}
      <aside class="panel" data-slot="right-panel">
        {#key edit}
          <AttributeForm
            layerDef={def}
            title={edit.mode === 'create' ? `Neu: ${def.title}` : def.title}
            initial={edit.mode === 'create' ? initialFormValues(def) : initialFormValues(def, edit.feature.getProperties())}
            onsave={saveEdit}
            oncancel={cancelEdit}
          />
          {#if def.photos && edit.mode === 'create'}
            <PhotoGallery layerId={editLayer} featureId={null} editable={true} />
          {/if}
        {/key}
      </aside>
    {:else if selection && config}
      <aside class="panel" data-slot="right-panel">
        <FeaturePanel
          layerId={selection.layerId}
          maxPhotoMb={config.app.maxPhotoMb}
          layerDef={config.layers[selection.layerId]}
          feature={selection.feature}
          editable={editLayer === selection.layerId}
          onedit={startEdit}
        />
      </aside>
    {/if}
  </div>
</div>

<style>
  :global(html, body) { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  :global(#app) { height: 100%; }
  .app { display: flex; flex-direction: column; height: 100%; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 48px; background: #1f3a5f; color: #fff; flex: none; }
  header h1 { font-size: 18px; margin: 0; }
  .body { display: flex; flex: 1; min-height: 0; }
  .sidebar { width: 280px; flex: none; border-right: 1px solid #ccc; padding: 12px; overflow: auto; background: #f7f7f7; box-sizing: border-box; }
  .mapwrap { flex: 1; min-width: 0; position: relative; display: flex; }
  .map { flex: 1; min-width: 0; }
  .panel { width: 340px; flex: none; border-left: 1px solid #ccc; padding: 12px; overflow: auto; box-sizing: border-box; }
  .error { color: #b00020; }
</style>

<script lang="ts">
  import type { LayerDef } from '@minigis/shared';
  import type Feature from 'ol/Feature';
  import PhotoGallery from './PhotoGallery.svelte';

  let {
    layerId,
    layerDef,
    feature,
    maxPhotoMb,
    editable,
    onedit,
  }: {
    layerId: string;
    layerDef: LayerDef;
    feature: Feature;
    maxPhotoMb?: number;
    editable: boolean;
    onedit: () => void;
  } = $props();

  function formatValue(type: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '–';
    if (type === 'boolean') return value === true || value === 1 || value === 'true' ? 'Ja' : 'Nein';
    if (type === 'date') {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
      return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value);
    }
    return String(value);
  }

  function formatTimestamp(value: unknown): string {
    if (typeof value !== 'string') return '–';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('de-CH');
  }

  const createdBy = $derived(feature.get('created_by') as string | null | undefined);
  const updatedAt = $derived(feature.get('updated_at'));
</script>

<section>
  <h2>{layerDef.title}</h2>
  <dl>
    {#each layerDef.attributes as attr (attr.name)}
      <dt>{attr.label ?? attr.name}</dt>
      <dd class:multiline={attr.type === 'textarea'}>{formatValue(attr.type, feature.get(attr.name))}</dd>
    {/each}
  </dl>
  <p class="meta">
    {#if createdBy}Erstellt von {createdBy}<br />{/if}
    Zuletzt geändert: {formatTimestamp(updatedAt)}
  </p>
  {#if editable}
    <button class="primary" onclick={onedit}>Bearbeiten</button>
  {/if}
  {#if layerDef.photos}
    {#key `${layerId}:${feature.getId()}`}
      <PhotoGallery {layerId} featureId={(feature.getId() as number | undefined) ?? null} {editable} {maxPhotoMb} />
    {/key}
  {/if}
</section>

<style>
  h2 { font-size: 16px; margin: 0 0 12px; }
  dl { margin: 0; }
  dt { font-size: 12px; color: #666; margin-top: 8px; }
  dd { margin: 2px 0 0; }
  .multiline { white-space: pre-wrap; }
  .meta { font-size: 11px; color: #777; margin: 16px 0; }
  .primary { padding: 6px 14px; font: inherit; cursor: pointer; }
</style>

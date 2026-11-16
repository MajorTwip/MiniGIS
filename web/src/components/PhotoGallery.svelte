<script lang="ts">
  import { api, type PhotoMeta } from '../api';
  import { isCurrent, photoErrorMessage } from '../photos';

  let {
    layerId,
    featureId,
    editable,
    maxPhotoMb,
  }: {
    layerId: string;
    featureId: number | null;
    editable: boolean;
    maxPhotoMb?: number;
  } = $props();

  let photos = $state<PhotoMeta[]>([]);
  let loadError = $state('');
  let uploadError = $state('');
  let progress = $state('');
  let uploading = $state(false);
  let dragging = $state(false);
  let viewing = $state<PhotoMeta | null>(null);
  let pendingDelete = $state<PhotoMeta | null>(null);
  let deleting = $state(false);
  let deleteError = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  // Reload whenever the selected feature changes; ignore stale responses.
  $effect(() => {
    const layer = layerId;
    const id = featureId;
    photos = [];
    loadError = '';
    uploadError = '';
    viewing = null;
    pendingDelete = null;
    uploading = false;
    progress = '';
    deleting = false;
    deleteError = '';
    if (id === null) return;
    let stale = false;
    api
      .listPhotos(layer, id)
      .then((list) => {
        if (!stale) photos = list;
      })
      .catch(() => {
        if (!stale) loadError = 'Fotos konnten nicht geladen werden';
      });
    return () => {
      stale = true;
    };
  });

  // Esc closes the overlay or the confirm dialog; listener only exists while one is open.
  $effect(() => {
    if (!viewing && !pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingDelete) {
        if (!deleting) pendingDelete = null;
      } else {
        viewing = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function upload(files: File[]) {
    if (featureId === null || files.length === 0 || uploading) return;
    const layer = layerId;
    const id = featureId;
    const current = () => isCurrent({ layer, id }, { layer: layerId, id: featureId });
    uploading = true;
    uploadError = '';
    progress = files.length === 1 ? `Lade ${files[0].name} hoch …` : `Lade ${files.length} Fotos hoch …`;
    try {
      const created = await api.uploadPhotos(layer, id, files);
      if (current()) photos = [...photos, ...created];
    } catch (err) {
      if (current()) uploadError = photoErrorMessage(err, maxPhotoMb);
    } finally {
      if (current()) {
        uploading = false;
        progress = '';
        if (fileInput) fileInput.value = '';
      }
    }
  }

  function onPick(e: Event) {
    upload(Array.from((e.currentTarget as HTMLInputElement).files ?? []));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    upload(Array.from(e.dataTransfer?.files ?? []));
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    const layer = layerId;
    const id = featureId;
    const current = () => isCurrent({ layer, id }, { layer: layerId, id: featureId });
    deleting = true;
    deleteError = '';
    try {
      await api.deletePhoto(target.id);
      if (current()) {
        photos = photos.filter((p) => p.id !== target.id);
        if (pendingDelete?.id === target.id) pendingDelete = null;
      }
    } catch {
      if (current()) deleteError = 'Foto konnte nicht gelöscht werden';
    } finally {
      if (current()) deleting = false;
    }
  }

  function askDelete(p: PhotoMeta) {
    deleteError = '';
    pendingDelete = p;
  }
</script>

<section class="gallery">
  <h3>Fotos{featureId !== null ? ` (${photos.length})` : ''}</h3>

  {#if featureId === null}
    <p class="hint">Fotos nach dem Speichern hinzufügen</p>
  {:else}
    {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}
    {#if photos.length === 0 && !loadError}<p class="hint">Keine Fotos</p>{/if}
    <div class="grid">
      {#each photos as p (p.id)}
        <div class="item">
          <button class="thumb" onclick={() => (viewing = p)} title={p.filename} aria-label={`Foto ${p.filename} öffnen`}>
            <img src={api.thumbUrl(p.id)} alt={p.filename} loading="lazy" />
          </button>
          {#if editable}
            <button class="del" onclick={() => askDelete(p)} title="Foto löschen" aria-label={`Foto ${p.filename} löschen`}>×</button>
          {/if}
        </div>
      {/each}
    </div>

    {#if editable}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="drop"
        class:dragging
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
      >
        <p>Fotos hierher ziehen oder</p>
        <input
          bind:this={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onchange={onPick}
          disabled={uploading}
          aria-label="Fotos auswählen"
        />
      </div>
      {#if progress}<p class="progress" role="status">{progress}</p>{/if}
      {#if uploadError}<p class="error" role="alert">{uploadError}</p>{/if}
    {/if}
  {/if}
</section>

{#if viewing}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) viewing = null; }}>
    <img src={api.photoUrl(viewing.id)} alt={viewing.filename} />
    <button class="close" onclick={() => (viewing = null)} aria-label="Schliessen">×</button>
  </div>
{/if}

{#if pendingDelete}
  <div class="backdrop">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="photo-del-title">
      <h3 id="photo-del-title">Foto löschen?</h3>
      <p>{pendingDelete.filename} wird endgültig gelöscht.</p>
      {#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
      <div class="actions">
        <button class="danger" onclick={confirmDelete} disabled={deleting}>Löschen</button>
        <button onclick={() => (pendingDelete = null)} disabled={deleting}>Abbrechen</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .gallery { margin-top: 16px; border-top: 1px solid #ddd; padding-top: 8px; }
  h3 { font-size: 14px; margin: 0 0 8px; }
  .hint { font-size: 12px; color: #666; margin: 4px 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .item { position: relative; }
  .thumb { display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 1px solid #ccc; background: #eee; cursor: pointer; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .del { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; padding: 0; line-height: 1; border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 16px; cursor: pointer; }
  .drop { margin-top: 10px; border: 2px dashed #bbb; border-radius: 4px; padding: 8px; text-align: center; font-size: 12px; }
  .drop.dragging { border-color: #1f3a5f; background: #eef3fa; }
  .drop p { margin: 0 0 6px; }
  .drop input { max-width: 100%; font-size: 12px; }
  .progress { font-size: 12px; color: #1f3a5f; margin: 6px 0; }
  .error { color: #b00020; font-size: 13px; margin: 6px 0; }
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); display: flex; align-items: center; justify-content: center; z-index: 200; }
  .overlay img { max-width: 92vw; max-height: 92vh; object-fit: contain; }
  .close { position: absolute; top: 16px; right: 20px; width: 36px; height: 36px; border: none; border-radius: 50%; background: #fff; font-size: 24px; line-height: 1; cursor: pointer; }
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; z-index: 300; }
  .dialog { background: #fff; border-radius: 6px; padding: 16px 20px; width: 340px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
  .dialog h3 { font-size: 16px; }
  .dialog p { margin: 0 0 12px; font-size: 14px; word-break: break-all; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .actions button { padding: 4px 12px; font: inherit; cursor: pointer; }
  .danger { background: #b00020; color: #fff; border: 1px solid #8e001a; border-radius: 3px; }
</style>

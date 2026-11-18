<script lang="ts">
  import type { SnapStatus } from '../map/roadSnapping';

  let {
    layerTitle,
    mode,
    hasSelection,
    onnew,
    onedit,
    ondelete,
    oncancel,
    snap = null,
  }: {
    layerTitle: string;
    /** Current edit operation, or null when idle. */
    mode: 'draw' | 'create' | 'update' | null;
    hasSelection: boolean;
    onnew: () => void;
    onedit: () => void;
    /** Deletes the selected feature; a rejection is shown in the dialog. */
    ondelete: () => Promise<void>;
    oncancel: () => void;
    /** Road snapping toggle; null hides it (layer without `snapToRoads`). */
    snap?: { enabled: boolean; status: SnapStatus; ontoggle: (enabled: boolean) => void } | null;
  } = $props();

  const SNAP_STATUS: Partial<Record<SnapStatus, string>> = {
    loading: 'Strassen werden geladen …',
    zoom: 'Zum Fangen an Strassen näher heranzoomen.',
    error: 'Strassen für das Fangen konnten nicht geladen werden.',
  };

  let confirming = $state(false);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  const HINTS = {
    draw: 'In die Karte klicken, um zu zeichnen (Linie/Fläche mit Doppelklick abschliessen). Esc bricht ab.',
    create: 'Attribute erfassen und speichern. Esc bricht ab.',
    update: 'Punkte/Stützpunkte ziehen oder das Objekt verschieben. Esc bricht ab.',
  };

  function openConfirm() {
    deleteError = null;
    confirming = true;
  }

  async function confirmDelete() {
    deleting = true;
    deleteError = null;
    try {
      await ondelete();
      confirming = false;
    } catch {
      deleteError = 'Löschen fehlgeschlagen';
    } finally {
      deleting = false;
    }
  }

  $effect(() => {
    if (!mode && !confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirming) {
        if (!deleting) confirming = false;
      } else oncancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="toolbar">
  <div class="row" role="toolbar" aria-label="Bearbeiten: {layerTitle}">
    <span class="layer">✎ {layerTitle}</span>
    <button onclick={onnew} disabled={!!mode}>Neu</button>
    <button onclick={onedit} disabled={!!mode || !hasSelection}>Bearbeiten</button>
    <button onclick={openConfirm} disabled={!!mode || !hasSelection}>Löschen</button>
    {#if snap}
      <label class="snap" title="Stützpunkte beim Zeichnen und Bearbeiten an swisstopo-Strassen fangen">
        <input type="checkbox" checked={snap.enabled} onchange={(e) => snap.ontoggle(e.currentTarget.checked)} />
        An Strassen fangen
      </label>
    {/if}
  </div>
  {#if mode}<p class="hint">{HINTS[mode]}</p>{/if}
  {#if snap?.enabled && (mode === 'draw' || mode === 'update') && SNAP_STATUS[snap.status]}
    <p class="hint snap-status" role="status">{SNAP_STATUS[snap.status]}</p>
  {/if}
</div>

{#if confirming}
  <div class="backdrop">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <h3 id="confirm-title">Objekt löschen?</h3>
      <p>Das Objekt und seine Fotos werden endgültig gelöscht.</p>
      {#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
      <div class="actions">
        <button class="danger" onclick={confirmDelete} disabled={deleting}>Löschen</button>
        <button onclick={() => (confirming = false)} disabled={deleting}>Abbrechen</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toolbar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 10; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; box-shadow: var(--shadow); width: max-content; max-width: calc(100% - 120px); }
  .row { display: flex; align-items: center; gap: 6px; }
  .layer { font-weight: 600; font-size: 13px; margin: 0 6px 0 4px; white-space: nowrap; color: var(--primary-text); }
  .hint { font-size: 12px; color: var(--muted-foreground); margin: 6px 4px 0; max-width: 340px; }
  button { padding: 4px 12px; }
  .snap { display: flex; align-items: center; gap: 4px; font-size: 13px; margin-left: 6px; padding-left: 10px; border-left: 1px solid var(--border); white-space: nowrap; cursor: pointer; }
  .backdrop { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; width: 340px; box-shadow: var(--shadow); }
  .dialog h3 { margin: 0 0 8px; font-size: 16px; }
  .dialog p { margin: 0 0 12px; font-size: 14px; }
  .error { color: var(--destructive-foreground); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>

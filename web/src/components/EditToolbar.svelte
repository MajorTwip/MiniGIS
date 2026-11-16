<script lang="ts">
  let {
    layerTitle,
    mode,
    hasSelection,
    onnew,
    onedit,
    ondelete,
    oncancel,
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
  } = $props();

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
  </div>
  {#if mode}<p class="hint">{HINTS[mode]}</p>{/if}
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
  .toolbar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 10; background: #fff; border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); width: max-content; max-width: calc(100% - 120px); }
  .row { display: flex; align-items: center; gap: 6px; }
  .layer { font-weight: 600; font-size: 13px; margin-right: 4px; white-space: nowrap; }
  .hint { font-size: 12px; color: #555; margin: 6px 0 0; max-width: 340px; }
  button { padding: 4px 12px; font: inherit; cursor: pointer; }
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: #fff; border-radius: 6px; padding: 16px 20px; width: 340px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
  .dialog h3 { margin: 0 0 8px; font-size: 16px; }
  .dialog p { margin: 0 0 12px; font-size: 14px; }
  .error { color: #b00020; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .danger { background: #b00020; color: #fff; border: 1px solid #8e001a; border-radius: 3px; }
</style>

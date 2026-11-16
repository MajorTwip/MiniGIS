<script lang="ts">
  import type { AttributeValue, LayerDef } from '@minigis/shared';
  import { ApiError } from '../api';
  import { buildFormFields, formToValues, type FormValues } from '../form';

  let {
    layerDef,
    title,
    initial,
    onsave,
    oncancel,
  }: {
    layerDef: LayerDef;
    title: string;
    initial: FormValues;
    /** Persists the values; may throw ApiError (422 errors are shown per field). */
    onsave: (values: Record<string, AttributeValue>) => Promise<void>;
    oncancel: () => void;
  } = $props();

  const fields = $derived(buildFormFields(layerDef));
  // The form is re-mounted per edit, so the initial values are read once.
  // svelte-ignore state_referenced_locally
  let values = $state<FormValues>({ ...initial });
  let errors = $state<Record<string, string>>({});
  let banner = $state<string | null>(null);
  let saving = $state(false);

  // Browsers report unparseable number input as ''; keep it as a value the
  // shared validation rejects ('Zahl erwartet') instead of silently clearing it.
  const UNPARSEABLE = '?';
  function setNumber(name: string, el: HTMLInputElement) {
    values[name] = el.validity.badInput ? UNPARSEABLE : el.value;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    banner = null;
    const result = formToValues(layerDef, values);
    errors = result.errors;
    if (Object.keys(errors).length) return;
    saving = true;
    try {
      await onsave(result.values);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.errors) {
        const { geometry, ...fieldErrors } = err.errors;
        errors = fieldErrors;
        if (geometry) banner = `Geometrie: ${geometry}`;
        else if (!Object.keys(fieldErrors).length) banner = 'Eingaben ungültig';
      } else {
        banner = err instanceof ApiError ? `Speichern fehlgeschlagen (${err.message})` : 'Speichern fehlgeschlagen';
      }
    } finally {
      saving = false;
    }
  }
</script>

<form onsubmit={submit} novalidate>
  <h2>{title}</h2>
  {#if banner}<p class="banner" role="alert">{banner}</p>{/if}
  {#each fields as f (f.name)}
    {@const id = `attr-${f.name}`}
    <div class="field" class:invalid={!!errors[f.name]} oninput={() => delete errors[f.name]}>
      {#if f.input === 'checkbox'}
        <label class="check">
          <input {id} type="checkbox" bind:checked={values[f.name] as boolean} />
          {f.label}
        </label>
      {:else}
        <label for={id}>{f.label}{#if f.required}<span class="req" aria-hidden="true"> *</span>{/if}</label>
        {#if f.input === 'textarea'}
          <textarea {id} rows="3" bind:value={values[f.name]}></textarea>
        {:else if f.input === 'select'}
          <select {id} bind:value={values[f.name]}>
            <option value="">–</option>
            {#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
          </select>
        {:else if f.input === 'number'}
          <input {id} type="number" step={f.step} value={values[f.name]} oninput={(e) => setNumber(f.name, e.currentTarget)} />
        {:else}
          <input {id} type={f.input} required={f.required} bind:value={values[f.name]} />
        {/if}
      {/if}
      {#if errors[f.name]}<span class="msg">{errors[f.name]}</span>{/if}
    </div>
  {/each}
  <div class="actions">
    <button type="submit" class="primary" disabled={saving}>Speichern</button>
    <button type="button" onclick={oncancel} disabled={saving}>Abbrechen</button>
  </div>
</form>

<style>
  h2 { font-size: 16px; margin: 0 0 12px; }
  .field { display: flex; flex-direction: column; margin-bottom: 10px; }
  label { font-size: 12px; color: #555; margin-bottom: 2px; }
  .check { flex-direction: row; display: flex; gap: 6px; align-items: center; font-size: 14px; color: inherit; }
  .req { color: #b00020; }
  input:not([type='checkbox']), select, textarea { font: inherit; padding: 4px 6px; border: 1px solid #bbb; border-radius: 3px; }
  .invalid input:not([type='checkbox']), .invalid select, .invalid textarea { border-color: #b00020; }
  .msg { color: #b00020; font-size: 12px; margin-top: 2px; }
  .banner { background: #fdecea; color: #b00020; padding: 6px 8px; border-radius: 3px; font-size: 13px; }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { padding: 6px 14px; font: inherit; cursor: pointer; }
</style>

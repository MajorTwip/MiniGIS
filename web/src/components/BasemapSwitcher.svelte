<script lang="ts">
  let {
    basemaps,
    active,
    onchange,
  }: {
    basemaps: { id: string; title: string }[];
    active: string;
    onchange: (id: string) => void;
  } = $props();
</script>

<label class="switcher">
  Hintergrundkarte
  <select value={active} onchange={(e) => onchange(e.currentTarget.value)}>
    {#each basemaps as b (b.id)}
      <option value={b.id}>{b.title}</option>
    {/each}
  </select>
</label>

<style>
  .switcher { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  select { padding: 4px 8px; font: inherit; }
</style>

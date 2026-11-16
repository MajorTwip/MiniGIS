<script lang="ts">
  import type { LayerDef, TreeNode } from '@minigis/shared';
  import { legendEntries } from '../map/vectorLayers';
  import LegendSwatch from './LegendSwatch.svelte';

  let {
    tree,
    layers,
    visible,
    editLayer,
    ontoggle,
    onsetEdit,
  }: {
    tree: TreeNode[];
    layers: Record<string, LayerDef>;
    visible: Set<string>;
    editLayer: string | null;
    ontoggle: (id: string) => void;
    onsetEdit: (id: string | null) => void;
  } = $props();

  let collapsed = $state(new Set<string>());

  function toggleGroup(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function toggleEdit(id: string) {
    if (editLayer === id) {
      onsetEdit(null);
      return;
    }
    if (!visible.has(id)) ontoggle(id);
    onsetEdit(id);
  }
</script>

{#snippet nodes(list: TreeNode[], parent: string)}
  <ul>
    {#each list as node, i (parent + '/' + i)}
      {#if 'group' in node}
        {@const path = parent + '/' + node.group}
        <li>
          <button class="group" onclick={() => toggleGroup(path)} aria-expanded={!collapsed.has(path)}>
            <span class="caret">{collapsed.has(path) ? '▸' : '▾'}</span>
            {node.group}
          </button>
          {#if !collapsed.has(path)}
            {@render nodes(node.children, path)}
          {/if}
        </li>
      {:else}
        {@const def = layers[node.layer]}
        {@const legend = def ? legendEntries(def) : []}
        <li>
          <div class="layer">
            <label>
              <input type="checkbox" checked={visible.has(node.layer)} onchange={() => ontoggle(node.layer)} />
              {def?.title ?? node.layer}
            </label>
            <button
              class="edit"
              class:active={editLayer === node.layer}
              title={editLayer === node.layer ? 'Bearbeitung beenden' : 'Ebene bearbeiten'}
              aria-pressed={editLayer === node.layer}
              onclick={() => toggleEdit(node.layer)}>✎</button
            >
          </div>
          {#if visible.has(node.layer) && legend.length > 0}
            <ul class="legend" aria-label="Legende {def.title}">
              {#each legend as entry (entry.value)}
                <li><LegendSwatch symbol={entry.symbol} />{entry.value}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
{/snippet}

<nav class="tree">
  <h2>Ebenen</h2>
  {@render nodes(tree, '')}
</nav>

<style>
  h2 { font-size: 14px; margin: 0 0 8px; text-transform: uppercase; color: #555; }
  ul { list-style: none; margin: 0; padding-left: 16px; }
  nav > :global(ul) { padding-left: 0; }
  li { margin: 2px 0; }
  .group { background: none; border: 0; font: inherit; font-weight: 600; cursor: pointer; padding: 2px 0; }
  .caret { display: inline-block; width: 1em; }
  .layer { display: flex; align-items: center; justify-content: space-between; }
  label { cursor: pointer; flex: 1; }
  .edit { background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; color: #888; font-size: 16px; }
  .edit:hover { border-color: #aaa; }
  .edit.active { background: #1f3a5f; color: #fff; }
</style>

<script lang="ts">
  import { toContext } from 'ol/render';
  import Point from 'ol/geom/Point';
  import { Style } from 'ol/style';
  import type { SymbolDef } from '@minigis/shared';
  import { symbolImage } from '../map/vectorLayers';

  let { symbol, size = 20 }: { symbol: SymbolDef; size?: number } = $props();
  let canvas: HTMLCanvasElement;

  $effect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const render = toContext(ctx, { size: [size, size], pixelRatio: window.devicePixelRatio || 1 });
    render.setStyle(new Style({ image: symbolImage(symbol, size * 0.3, false) }));
    render.drawGeometry(new Point([size / 2, size / 2]));
  });
</script>

<canvas bind:this={canvas} aria-hidden="true" style:width="{size}px" style:height="{size}px"></canvas>

<script>
	import { sanitizeHtml } from '$lib/sanitize.js';
	let { initialItems = [] } = $props();
	let items = $state([]);
	$effect(() => { if (initialItems?.length) items = [...initialItems]; });
	function clearItem(index) { items = items.filter((_, i) => i !== index); }
	function clearAll() { items = []; }
</script>

{#if items?.length > 0}
<section class="attention">
	<div class="att-hdr"><h3>Attention</h3><button class="clear-all" onclick={clearAll}>Clear</button></div>
	{#each items as item, i}
		<div class="att-item"><span>{@html sanitizeHtml(item)}</span><button class="x" onclick={() => clearItem(i)}>x</button></div>
	{/each}
</section>
{/if}

<style>
	.attention { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.75em 1em; margin-bottom: 1em; }
	.att-hdr { display: flex; justify-content: space-between; align-items: center; }
	.attention h3 { margin: 0 0 0.3em; font-size: 0.9em; color: var(--text-muted); }
	.att-item { display: flex; justify-content: space-between; gap: 0.5em; padding: 0.4em 0.6em; background: var(--code-bg); border-radius: 4px; margin-bottom: 0.3em; font-size: 0.88em; }
	.att-item :global(strong) { color: var(--link); }
	.x, .clear-all { background: none; border: none; color: var(--text-muted); cursor: pointer; }
	.x:hover, .clear-all:hover { color: var(--text); }
	.clear-all { font-size: 0.75em; border: 1px solid var(--border); padding: 0.2em 0.4em; border-radius: 4px; }
</style>

<script>
	// Folder breadcrumb trail. NOT a <nav> — the global `nav { position: fixed }` rule
	// would yank it out of flow.
	let { cwd = '', onnavigate } = $props();
	let parts = $derived(cwd ? cwd.split('/') : []);
	function pathTo(i) { return parts.slice(0, i + 1).join('/'); }
</script>

<div class="crumbs">
	<button class="crumb" onclick={() => onnavigate('')} disabled={!cwd}>🏠 Home</button>
	{#each parts as part, i}
		<span class="sep">/</span>
		<button class="crumb" onclick={() => onnavigate(pathTo(i))} disabled={i === parts.length - 1}>{part}</button>
	{/each}
</div>

<style>
	.crumbs { display: flex; align-items: center; gap: 0.3em; flex-wrap: wrap; margin-bottom: 0.75em; font-size: 0.85em; }
	.crumb { background: none; border: none; color: var(--link); cursor: pointer; padding: 0.1em 0.2em; font-size: inherit; }
	.crumb:disabled { color: var(--text); cursor: default; font-weight: 600; }
	.crumb:not(:disabled):hover { text-decoration: underline; }
	.sep { color: var(--text-muted); }
</style>

<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	let stats = $state(null);
	let interval;

	async function refresh() {
		try {
			const r = await fetch('/api/session/live');
			if (r.ok) stats = await r.json();
		} catch { /* ignore */ }
	}

	onMount(() => { if (!browser) return; refresh(); interval = setInterval(refresh, 8000); });
	onDestroy(() => clearInterval(interval));

	function fmtDuration(m) {
		if (!m || m < 1) return '<1m';
		if (m < 60) return `${m}m`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	}

	function shortPath(p) { const parts = (p || '').split('/'); return parts.slice(-2).join('/'); }
</script>

{#if stats?.active}
<div class="live-stats">
	<div class="stat-row">
		<span class="stat"><span class="label">Turns</span> {stats.turns}</span>
		<span class="stat"><span class="label">Tools</span> {stats.toolCalls}</span>
		<span class="stat"><span class="label">Duration</span> {fmtDuration(stats.durationMin)}</span>
		<span class="stat"><span class="label">Files</span> {stats.filesModified?.length || 0}</span>
	</div>
	{#if Object.keys(stats.topTools || {}).length > 0}
	<div class="tools-row">
		{#each Object.entries(stats.topTools).slice(0, 6) as [name, count]}
			<span class="tool-chip">{name} <span class="tool-count">{count}</span></span>
		{/each}
	</div>
	{/if}
	{#if stats.filesModified?.length > 0}
	<div class="files-row">
		{#each stats.filesModified.slice(0, 5) as f}
			<span class="file-chip" title={f}>{shortPath(f)}</span>
		{/each}
		{#if stats.filesModified.length > 5}
			<span class="file-more">+{stats.filesModified.length - 5}</span>
		{/if}
	</div>
	{/if}
</div>
{/if}

<style>
	.live-stats { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 0.8em; margin-bottom: 1em; font-size: 0.8em; }
	.stat-row { display: flex; gap: 1.2em; flex-wrap: wrap; }
	.stat { color: var(--text); font-weight: 600; font-family: monospace; }
	.label { color: var(--text-muted); font-weight: 400; font-family: inherit; margin-right: 0.3em; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.03em; }
	.tools-row { display: flex; gap: 0.4em; flex-wrap: wrap; margin-top: 0.5em; }
	.tool-chip { background: var(--code-bg); color: var(--text-muted); padding: 0.15em 0.5em; border-radius: 4px; font-family: monospace; font-size: 0.88em; }
	.tool-count { font-weight: 700; color: var(--text); margin-left: 0.2em; }
	.files-row { display: flex; gap: 0.4em; flex-wrap: wrap; margin-top: 0.4em; }
	.file-chip { background: var(--code-bg); color: var(--accent); padding: 0.1em 0.4em; border-radius: 3px; font-family: monospace; font-size: 0.82em; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-more { color: var(--text-muted); font-size: 0.85em; align-self: center; }
</style>

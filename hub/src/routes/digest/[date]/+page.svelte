<script>
	let { data } = $props();
</script>

<svelte:head><title>{data.date} — Digest</title></svelte:head>

<div class="digest-nav">
	<a href="/digest">← All digests</a>
	<span class="date">{data.date}</span>
</div>

<div class="digest-content">
	{@html data.html}
</div>

<style>
	.digest-nav {
		display: flex; align-items: center; gap: 1em;
		margin-bottom: 1.5em; padding-bottom: 0.75em;
		border-bottom: 1px solid var(--border);
	}
	.date { font-family: monospace; color: var(--text-muted); margin-left: auto; }
	.digest-content { line-height: 1.7; }
</style>

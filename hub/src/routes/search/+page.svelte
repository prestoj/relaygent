<script>
	import { sanitizeHtml } from '$lib/sanitize.js';
	let { data } = $props();
	let query = $state(data.query || '');
	let results = $state(data.results || []);
	let searching = $state(false);
	let debounceTimer;
	let kbCount = $derived(results.filter(r => r.type === 'topic').length);
	let sessionCount = $derived(results.filter(r => r.type === 'session').length);

	function highlight(text, q) {
		if (!text || !q) return sanitizeHtml(text || '');
		const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return sanitizeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
	}

	async function doSearch() {
		if (query.trim().length < 2) { results = []; return; }
		searching = true;
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&full=1`);
			if (res.ok) results = (await res.json()).results;
		} catch { /* ignore */ }
		searching = false;
	}

	function onInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(doSearch, 200);
	}
</script>

<svelte:head><title>Search{query ? `: ${query}` : ''}</title></svelte:head>

<h1>Search</h1>

<input type="search" bind:value={query} oninput={onInput} placeholder="Search knowledge base and sessions..." class="search" autofocus />

{#if query.trim().length >= 2}
	<p class="count">
		{searching ? 'Searching...' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
		{#if kbCount && sessionCount}
			<span class="breakdown">({kbCount} KB · {sessionCount} session{sessionCount !== 1 ? 's' : ''})</span>
		{/if}
	</p>
	<ul class="results">
		{#each results as r}
			<li>
				{#if r.type === 'session'}
					<a href="/sessions/{r.id}">{@html highlight(r.displayTime, query)}</a>
					<span class="type-badge session">Session</span>
				{:else}
					<a href="/kb/{r.slug}">{@html highlight(r.title || r.slug, query)}</a>
					<span class="type-badge topic">KB</span>
				{/if}
				{#if r.snippet}<p class="snippet">{@html highlight(r.snippet, query)}</p>{/if}
			</li>
		{:else}
			{#if !searching}<li class="empty">No results found.</li>{/if}
		{/each}
	</ul>
{/if}

<style>
	.search {
		width: 100%; padding: 0.6em 0.8em;
		border: 1px solid var(--border); border-radius: 6px;
		font-size: 1em; box-sizing: border-box;
		background: var(--bg-surface); color: var(--text);
	}
	.search:focus { outline: none; border-color: var(--link); }
	.count { color: var(--text-muted); font-size: 0.9em; }
	.breakdown { color: var(--text-muted); font-size: 0.9em; }
	.results { list-style: none; padding: 0; }
	.results li { padding: 0.5em 0; border-bottom: 1px solid var(--border); }
	.snippet { margin: 0.2em 0 0; font-size: 0.85em; color: var(--text-muted); }
	.empty { color: var(--text-muted); }
	.type-badge {
		font-size: 0.7em; padding: 0.15em 0.4em;
		border-radius: 3px; margin-left: 0.5em; vertical-align: middle;
	}
	.type-badge.topic { background: #6b7280; color: white; }
	.type-badge.session { background: #2563eb; color: white; }
	:global(mark) { background: color-mix(in srgb, var(--link) 20%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
</style>

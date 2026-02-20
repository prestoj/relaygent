<script>
	import { sanitizeHtml } from '$lib/sanitize.js';
	let { data } = $props();
	let kbCount = $derived(data.results.filter(r => r.type === 'topic').length);
	let sessionCount = $derived(data.results.filter(r => r.type === 'session').length);
	function highlight(text, query) {
		if (!text || !query) return sanitizeHtml(text || '');
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return sanitizeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
	}
</script>

<svelte:head><title>Search{data.query ? `: ${data.query}` : ''}</title></svelte:head>

<h1>Search</h1>

<form action="/search" method="GET">
	<input type="search" name="q" value={data.query} placeholder="Search knowledge base and sessions..." class="search" />
</form>

{#if data.query}
	<p class="count">
		{data.results.length} result{data.results.length !== 1 ? 's' : ''}
		{#if kbCount && sessionCount}
			<span class="breakdown">({kbCount} KB · {sessionCount} session{sessionCount !== 1 ? 's' : ''})</span>
		{/if}
	</p>
	<ul class="results">
		{#each data.results as r}
			<li>
				{#if r.type === 'session'}
					<a href="/sessions/{r.id}">{@html highlight(r.displayTime, data.query)}</a>
					<span class="type-badge session">Session</span>
				{:else}
					<a href="/kb/{r.slug}">{@html highlight(r.title || r.slug, data.query)}</a>
					<span class="type-badge topic">KB</span>
				{/if}
				{#if r.snippet}<p class="snippet">{@html highlight(r.snippet, data.query)}</p>{/if}
			</li>
		{:else}
			<li class="empty">No results found.</li>
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

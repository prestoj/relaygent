<script>
	let { data } = $props();
	let days = $state(data.days || 7);
	let prs = $state(data.prs || []);
	let commits = $state(data.commits || 0);
	let loading = $state(false);
	let error = $state(data.error || '');

	function fmtDate(iso) {
		if (!iso) return '';
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
	function prType(title) {
		if (title.startsWith('feat')) return 'feat';
		if (title.startsWith('fix')) return 'fix';
		if (title.startsWith('refactor')) return 'refactor';
		if (title.startsWith('test')) return 'test';
		if (title.startsWith('docs')) return 'docs';
		return 'other';
	}

	async function reload() {
		loading = true;
		try {
			const res = await fetch(`/api/changelog?days=${days}`);
			const d = await res.json();
			prs = d.prs || []; commits = d.commits || 0; error = d.error || '';
		} catch (e) { error = e.message; }
		loading = false;
	}
</script>

<svelte:head><title>Changelog</title></svelte:head>

<h1>Changelog</h1>

<div class="controls">
	<div class="range-btns">
		{#each [1, 3, 7, 14, 30] as d}
			<button class:active={days === d} onclick={() => { days = d; reload(); }}>{d === 1 ? 'Today' : `${d}d`}</button>
		{/each}
	</div>
	<span class="summary">
		{loading ? 'Loading...' : `${prs.length} PR${prs.length !== 1 ? 's' : ''} merged · ${commits} commit${commits !== 1 ? 's' : ''}`}
	</span>
</div>

{#if error}
	<p class="error">{error}</p>
{/if}

{#if prs.length > 0}
<ul class="pr-list">
	{#each prs as pr}
		<li>
			<a href="https://github.com/prestoj/relaygent/pull/{pr.number}" target="_blank" rel="noopener" class="pr-link">
				<span class="pr-num">#{pr.number}</span>
				<span class="pr-badge {prType(pr.title)}">{prType(pr.title)}</span>
				<span class="pr-title">{pr.title.replace(/^\w+(\([^)]*\))?:\s*/, '')}</span>
			</a>
			<span class="pr-meta">{fmtDate(pr.mergedAt)} · {pr.author}</span>
		</li>
	{/each}
</ul>
{:else if !loading && !error}
	<p class="empty">No merged PRs in this period.</p>
{/if}

<style>
	.controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em; flex-wrap: wrap; gap: 0.5em; }
	.range-btns { display: flex; gap: 0.3em; }
	.range-btns button {
		background: var(--bg-surface); border: 1px solid var(--border); border-radius: 5px;
		padding: 0.3em 0.7em; font-size: 0.82em; cursor: pointer; color: var(--text-muted);
	}
	.range-btns button.active { background: var(--link); color: white; border-color: var(--link); }
	.range-btns button:hover:not(.active) { border-color: var(--text-muted); }
	.summary { font-size: 0.85em; color: var(--text-muted); }
	.pr-list { list-style: none; padding: 0; }
	.pr-list li { padding: 0.5em 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; flex-wrap: wrap; }
	.pr-link { display: flex; align-items: baseline; gap: 0.4em; text-decoration: none; min-width: 0; }
	.pr-num { color: var(--text-muted); font-size: 0.82em; font-weight: 600; white-space: nowrap; }
	.pr-title { color: var(--text); }
	.pr-link:hover .pr-title { color: var(--link); }
	.pr-meta { font-size: 0.75em; color: var(--text-muted); white-space: nowrap; }
	.pr-badge {
		font-size: 0.65em; padding: 0.1em 0.35em; border-radius: 3px; font-weight: 600;
		text-transform: uppercase; white-space: nowrap;
	}
	.pr-badge.feat { background: #059669; color: white; }
	.pr-badge.fix { background: #dc2626; color: white; }
	.pr-badge.refactor { background: #7c3aed; color: white; }
	.pr-badge.test { background: #2563eb; color: white; }
	.pr-badge.docs { background: #6b7280; color: white; }
	.pr-badge.other { background: #6b7280; color: white; }
	.error { color: var(--error); font-size: 0.9em; }
	.empty { color: var(--text-muted); text-align: center; padding: 2em; }
</style>

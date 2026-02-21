<script>
	let { data } = $props();
	let search = $state('');
	let showTags = $state(false);
	let showDeadLinks = $state(false);
	let newTitle = $state('');
	let showNewForm = $state(false);
	let committing = $state(false);
	let commitDone = $state(false);

	async function commitKb() {
		if (committing) return;
		committing = true;
		try { const r = await fetch('/api/kb', { method: 'POST' }); if (r.ok) { commitDone = true; setTimeout(() => { commitDone = false; }, 3000); } } catch { /* ignore */ }
		committing = false;
	}

	function toSlug(s) {
		return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
	}

	function goCreate(e) {
		e.preventDefault();
		const slug = toSlug(newTitle);
		if (slug) window.location.href = `/kb/${slug}`;
	}

	let filtered = $derived(
		search
			? data.topics.filter(t =>
				(t.title || t.slug).toLowerCase().includes(search.toLowerCase()) ||
				(t.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()))
			)
			: data.topics
	);
</script>

<svelte:head><title>Knowledge Base</title></svelte:head>

<div class="heading-row">
	<h1>Knowledge Base <span class="count">({data.topics.length})</span></h1>
	{#if showNewForm}
		<form class="new-form" onsubmit={goCreate}>
			<input type="text" bind:value={newTitle} placeholder="Topic title..." class="new-input" autofocus />
			<button type="submit" class="new-submit">Create</button>
			<button type="button" class="new-cancel" onclick={() => { showNewForm = false; newTitle = ''; }}>✕</button>
		</form>
	{:else}
		<button class="new-btn" onclick={() => showNewForm = true}>+ New</button>
		<button class="commit-btn" onclick={commitKb} disabled={committing}>{committing ? '…' : commitDone ? '✓ Committed' : 'Commit KB'}</button>
	{/if}
</div>

<input type="search" placeholder="Filter topics or tags..." bind:value={search} class="search" />

{#if data.deadLinks.length > 0}
	<div class="dead-links-notice">
		<button class="dead-links-toggle" onclick={() => showDeadLinks = !showDeadLinks}>
			⚠ {data.deadLinks.length} broken wiki-link{data.deadLinks.length !== 1 ? 's' : ''}
			{showDeadLinks ? '▲' : '▼'}
		</button>
		{#if showDeadLinks}
			<ul class="dead-links-list">
				{#each data.deadLinks as link}
					<li>
						<a href="/kb/{link.source}">{link.source}</a>
						→ <code>[[{link.display}]]</code> (missing: <em>{link.target}</em>)
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

{#if data.activeTag}
	<div class="active-filter">
		Filtered by <strong>{data.activeTag}</strong> &middot; <a href="/kb">clear</a>
	</div>
{:else}
	<button class="toggle-tags" onclick={() => showTags = !showTags}>
		{showTags ? 'Hide' : 'Show'} tags ({data.allTags.length})
	</button>
{/if}

{#if showTags || data.activeTag}
	<div class="tags">
		{#each data.allTags as tag}
			<a href="/kb?tag={tag}" class="tag" class:active={tag === data.activeTag}>{tag}</a>
		{/each}
	</div>
{/if}

<ul class="topic-list">
	{#each filtered as topic}
		<li>
			<a href="/kb/{topic.slug}">{topic.title || topic.slug}</a>
			{#if topic.updated}<span class="date">{topic.updated}</span>{/if}
		</li>
	{:else}
		<li class="empty">No topics found.</li>
	{/each}
</ul>

{#if data.dailyLogs.length > 0 && !search}
	<h2 class="section-label">Daily Logs</h2>
	<ul class="topic-list">
		{#each data.dailyLogs as log}
			<li>
				<a href="/kb/{log.slug}">{log.slug}</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.heading-row { display: flex; align-items: center; justify-content: space-between; gap: 1em; }
	.heading-row h1 { margin: 0; }
	.new-btn {
		background: none; border: 1px solid var(--border); color: var(--link);
		border-radius: 6px; padding: 0.3em 0.7em; font-size: 0.85em; cursor: pointer; white-space: nowrap;
	}
	.new-btn:hover { border-color: var(--link); background: color-mix(in srgb, var(--link) 8%, transparent); }
	.commit-btn {
		background: none; border: 1px solid var(--border); color: var(--text-muted);
		border-radius: 6px; padding: 0.3em 0.7em; font-size: 0.85em; cursor: pointer; white-space: nowrap;
	}
	.commit-btn:hover { border-color: var(--link); color: var(--link); }
	.commit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.new-form { display: flex; gap: 0.4em; align-items: center; }
	.new-input {
		padding: 0.35em 0.6em; border: 1px solid var(--border); border-radius: 6px;
		font-size: 0.9em; background: var(--bg-surface); color: var(--text); width: 16em;
	}
	.new-submit { background: var(--link); color: #fff; border: none; border-radius: 6px; padding: 0.35em 0.7em; cursor: pointer; font-size: 0.85em; }
	.new-submit:hover { opacity: 0.85; }
	.new-cancel { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.9em; padding: 0.2em; }
	.count { font-weight: 400; color: var(--text-muted); font-size: 0.6em; }
	.search {
		width: 100%;
		padding: 0.6em 0.8em;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 1em;
		margin: 0.5em 0;
		box-sizing: border-box;
		background: var(--bg-surface);
		color: var(--text);
	}
	.active-filter {
		margin: 0.5em 0;
		font-size: 0.9em;
		color: var(--text-muted);
	}
	.toggle-tags {
		background: none;
		border: none;
		color: var(--link);
		cursor: pointer;
		font-size: 0.85em;
		padding: 0.25em 0;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4em;
		margin: 0.5em 0;
	}
	.tag {
		font-size: 0.8em;
		padding: 0.2em 0.6em;
		background: var(--code-bg);
		border-radius: 12px;
		color: var(--text-muted);
	}
	.tag.active { background: var(--link); color: #fff; }
	.topic-list { list-style: none; padding: 0; }
	.topic-list li {
		display: flex;
		justify-content: space-between;
		padding: 0.4em 0;
		border-bottom: 1px solid var(--border);
	}
	.date { color: var(--text-muted); font-size: 0.85em; }
	.empty { color: var(--text-muted); }
	.section-label { font-size: 1em; color: var(--text-muted); margin-top: 2em; }
	.dead-links-notice { margin: 0.5em 0; }
	.dead-links-toggle {
		background: none; border: none; cursor: pointer;
		font-size: 0.85em; padding: 0.25em 0;
		color: var(--warning, #b45309);
	}
	.dead-links-list {
		list-style: none; padding: 0.25em 0 0 0;
		font-size: 0.85em; color: var(--text-muted);
	}
	.dead-links-list li { padding: 0.2em 0; }
	.dead-links-list code { background: var(--code-bg); border-radius: 3px; padding: 0.1em 0.3em; }
</style>

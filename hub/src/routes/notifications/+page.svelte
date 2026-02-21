<script>
	let { data } = $props();

	const typeIcons = { reminder: '\u23F0', message: '\uD83D\uDCAC', slack: '\uD83D\uDCE8', email: '\u2709\uFE0F', github: '\uD83D\uDC19', linear: '\uD83D\uDCCB' };
	const typeColors = { reminder: '#f59e0b', message: '#22c55e', slack: '#e01e5a', email: '#3b82f6', github: '#8b5cf6', linear: '#5e6ad2' };

	function fmtTime(iso) {
		if (!iso) return '';
		try {
			const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
			const now = new Date();
			const diffMin = Math.round((now - d) / 60000);
			if (diffMin < 2) return 'just now';
			if (diffMin < 60) return `${diffMin}m ago`;
			const diffH = Math.round(diffMin / 60);
			if (diffH < 24) return `${diffH}h ago`;
			const diffD = Math.round(diffH / 24);
			if (diffD < 7) return `${diffD}d ago`;
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		} catch { return iso; }
	}

	function fmtAbsolute(iso) {
		if (!iso) return '';
		try {
			const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
			return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
		} catch { return ''; }
	}

	function parseContent(entry) {
		try { return JSON.parse(entry.content); } catch { return null; }
	}
</script>

<svelte:head><title>Notifications — Relaygent</title></svelte:head>

<div class="header">
	<h1>Notification History</h1>
	<span class="sub">Last 7 days</span>
</div>

{#if data.error}
	<p class="error">{data.error}</p>
{/if}

{#if data.entries.length === 0}
	<p class="empty">No notifications recorded yet. Notifications will appear here as they come in.</p>
{:else}
	<div class="feed">
		{#each data.entries as entry}
			{@const parsed = parseContent(entry)}
			<div class="item" style="border-left-color: {typeColors[entry.type] || '#6b7280'}">
				<div class="icon">{typeIcons[entry.type] || '\uD83D\uDD14'}</div>
				<div class="body">
					<div class="top-row">
						<span class="type-badge" style="background: {typeColors[entry.type] || '#6b7280'}">{entry.type}</span>
						{#if entry.source !== entry.type}<span class="source">{entry.source}</span>{/if}
						<span class="time" title={fmtAbsolute(entry.timestamp)}>{fmtTime(entry.timestamp)}</span>
					</div>
					<p class="summary">{entry.summary}</p>
					{#if parsed?.channel_name}<span class="detail">#{parsed.channel_name}</span>{/if}
					{#if parsed?.from}<span class="detail">from {parsed.from}</span>{/if}
					{#if parsed?.url}<a href={parsed.url} class="detail-link" target="_blank">View</a>{/if}
				</div>
			</div>
		{/each}
	</div>

	<div class="pagination">
		{#if data.page > 1}
			<a href="/notifications?page={data.page - 1}" class="page-btn">Newer</a>
		{/if}
		<span class="page-info">Page {data.page}</span>
		{#if data.hasMore}
			<a href="/notifications?page={data.page + 1}" class="page-btn">Older</a>
		{/if}
	</div>
{/if}

<style>
	.header { display: flex; align-items: baseline; gap: 0.75em; margin-bottom: 1em; }
	h1 { margin: 0; font-size: 1.4em; }
	.sub { font-size: 0.8em; color: var(--text-muted); }
	.error { color: #ef4444; font-size: 0.85em; }
	.empty { color: var(--text-muted); font-size: 0.9em; }
	.feed { display: flex; flex-direction: column; gap: 0.4em; }
	.item { display: flex; gap: 0.6em; padding: 0.5em 0.7em; background: var(--bg-surface); border-radius: 6px; border-left: 3px solid var(--border); }
	.icon { font-size: 1.1em; flex-shrink: 0; width: 1.5em; text-align: center; }
	.body { flex: 1; min-width: 0; }
	.top-row { display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; }
	.type-badge { font-size: 0.65em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: white; padding: 0.1em 0.4em; border-radius: 3px; }
	.source { font-size: 0.75em; color: var(--text-muted); }
	.time { font-size: 0.75em; color: var(--text-muted); margin-left: auto; white-space: nowrap; }
	.summary { margin: 0.2em 0 0; font-size: 0.85em; line-height: 1.4; word-break: break-word; }
	.detail { font-size: 0.75em; color: var(--text-muted); }
	.detail-link { font-size: 0.75em; }
	.pagination { display: flex; align-items: center; gap: 1em; margin-top: 1.2em; justify-content: center; }
	.page-btn { font-size: 0.85em; padding: 0.3em 0.8em; border: 1px solid var(--border); border-radius: 6px; color: var(--link); text-decoration: none; }
	.page-btn:hover { border-color: var(--link); background: color-mix(in srgb, var(--link) 8%, transparent); }
	.page-info { font-size: 0.8em; color: var(--text-muted); }
</style>

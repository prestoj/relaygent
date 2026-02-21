<script>
	let { data } = $props();
	function fmtTokens(n) {
		if (!n) return '0';
		if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
		if (n >= 1000) return `${(n/1000).toFixed(0)}K`;
		return String(n);
	}
	function fmtRelative(id) {
		try {
			const m = id.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
			if (!m) return '';
			const d = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
			const diffMin = Math.round((Date.now() - d) / 60000);
			if (diffMin < 2) return 'just now';
			if (diffMin < 60) return `${diffMin}m ago`;
			const diffH = Math.round(diffMin / 60);
			if (diffH < 24) return `${diffH}h ago`;
			return `${Math.round(diffH / 24)}d ago`;
		} catch { return ''; }
	}
	function dateFromId(id) {
		const m = id.match(/^(\d{4})-(\d{2})-(\d{2})/);
		return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
	}
	function groupSessions(sessions) {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
		const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
		const groups = [];
		let cur = null;
		for (const s of sessions) {
			const d = dateFromId(s.id);
			const label = !d ? 'Older' : d >= today ? 'Today' : d >= yesterday ? 'Yesterday' : d >= weekAgo ? 'This Week' : 'Older';
			if (!cur || cur.label !== label) { cur = { label, items: [] }; groups.push(cur); }
			cur.items.push(s);
		}
		return groups;
	}
	const st = data.stats;
	let query = $state('');
	let filtered = $derived(query.trim()
		? data.sessions.filter(s => {
			const q = query.toLowerCase();
			return s.id.includes(q) || (s.summary || '').toLowerCase().includes(q)
				|| (s.displayTime || '').toLowerCase().includes(q);
		})
		: data.sessions);
	let groups = $derived(groupSessions(filtered));
</script>

<svelte:head><title>Sessions — Relaygent</title></svelte:head>

<h1>Relay Sessions</h1>

{#if st && st.totalSessions > 0}
<div class="stats-row">
	<span class="stat"><strong>{st.totalSessions}</strong> sessions</span>
	<span class="sep">·</span>
	<span class="stat"><strong>{fmtTokens(st.totalTokens)}</strong> tokens in</span>
	<span class="sep">·</span>
	<span class="stat"><strong>{st.avgDuration}m</strong> avg</span>
	{#if st.topTools[0]}<span class="sep">·</span>
	<span class="stat">top: <strong>{st.topTools[0].name}</strong> ({st.topTools[0].count}×)</span>{/if}
</div>
{/if}

{#if data.sessions.length > 5}
<div class="search-bar">
	<input type="text" bind:value={query} placeholder="Search sessions..." class="search-input" />
	{#if query}<button class="search-clear" onclick={() => query = ''}>x</button>{/if}
</div>
{/if}

{#if filtered.length === 0}
	<p style="color: var(--text-muted)">{query ? 'No matching sessions.' : 'No sessions found.'}</p>
{:else}
	{#each groups as group}
		<h2 class="group-label">{group.label}</h2>
		<ul class="session-list">
			{#each group.items as s, i}
				{@const isFirst = group === groups[0] && i === 0}
				<li class:current={isFirst}>
					<div class="row">
						<a href="/sessions/{s.id}">{s.displayTime}</a>
						{#if fmtRelative(s.id)}<span class="rel">{fmtRelative(s.id)}</span>{/if}
						<span class="meta">
							{#if s.durationMin != null}{s.durationMin}m · {/if}{#if s.totalTokens != null}{fmtTokens(s.totalTokens)} tok · {/if}{#if s.toolCalls != null}{s.toolCalls} tools{/if}{isFirst ? ' · current' : ''}
						</span>
					</div>
					{#if s.summary}<p class="sum">{s.summary}</p>{/if}
				</li>
			{/each}
		</ul>
	{/each}
	{#if data.truncated}
		<div class="show-all">
			<span class="trunc-note">Showing {data.sessions.length} of {data.total} sessions</span>
			<a href="/sessions?all=1" class="show-all-btn">Show all {data.total}</a>
		</div>
	{/if}
{/if}

<style>
	h1 { margin-top: 0; }
	.stats-row { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: center; margin-bottom: 1em;
		font-size: 0.85em; color: var(--text-muted); }
	.stats-row strong { color: var(--text); }
	.sep { color: var(--border); }
	.group-label { font-size: 0.8em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 1.2em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
	.group-label:first-of-type { margin-top: 0; }
	.session-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5em; margin: 0; }
	.session-list li { display: flex; flex-direction: column; gap: 0.1em; }
	.row { display: flex; align-items: baseline; gap: 0.75em; }
	.session-list a { font-family: monospace; font-size: 1.05em; }
	.rel { font-size: 0.75em; color: var(--text-muted); opacity: 0.7; }
	.meta { font-size: 0.8em; color: var(--text-muted); }
	.sum { margin: 0; font-size: 0.75em; color: var(--text-muted); padding-left: 0.2em; }
	.current a { font-weight: 600; }
	.show-all { display: flex; align-items: center; gap: 0.75em; margin-top: 1em; padding: 0.6em 0; }
	.trunc-note { font-size: 0.8em; color: var(--text-muted); }
	.show-all-btn { font-size: 0.8em; padding: 0.3em 0.7em; border: 1px solid var(--border); border-radius: 6px; color: var(--link); text-decoration: none; }
	.show-all-btn:hover { border-color: var(--link); background: color-mix(in srgb, var(--link) 8%, transparent); }
	.search-bar { display: flex; align-items: center; gap: 0.4em; margin-bottom: 1em; }
	.search-input { flex: 1; padding: 0.4em 0.7em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text); font-size: 0.85em; outline: none; }
	.search-input:focus { border-color: var(--link); }
	.search-clear { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85em; padding: 0.2em 0.4em; }
	.search-clear:hover { color: var(--text); }
</style>

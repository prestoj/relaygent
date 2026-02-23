<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	let peers = $state([]);
	let loading = $state(true);
	let error = $state(null);
	let lastRefresh = $state(null);

	async function refresh() {
		try {
			const r = await fetch('/api/fleet');
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			peers = await r.json();
			error = null;
			lastRefresh = new Date();
		} catch (e) { error = e.message; }
		loading = false;
	}

	onMount(() => {
		refresh();
		const iv = setInterval(refresh, 10000);
		return () => clearInterval(iv);
	});

	function relayBadge(h) {
		if (!h) return { cls: 'down', label: 'Unreachable' };
		const s = h.relay?.status;
		if (s === 'working') return { cls: 'ok', label: 'Working' };
		if (s === 'sleeping') return { cls: 'warn', label: 'Sleeping' };
		return { cls: 'off', label: s || 'Off' };
	}

	function fmtDuration(min) {
		if (!min) return '--';
		if (min < 60) return `${Math.round(min)}m`;
		return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
	}

	function fmtContext(pct) {
		if (pct == null) return '--';
		return `${Math.round(pct)}%`;
	}
</script>

<h1>Fleet</h1>
{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading...</p>
{:else if peers.length === 0}<p class="muted">No fleet peers configured.</p>
{:else}
<div class="fleet-grid">
	{#each peers as p}
		{@const badge = relayBadge(p.health)}
		{@const s = p.session}
		<div class="peer-card" class:unreachable={!p.health}>
			<div class="peer-header">
				{#if !p.local && p.health}<a class="peer-name" href={p.url} target="_blank" rel="noopener">{p.health.hostname || p.name}</a>
				{:else}<span class="peer-name">{p.health?.hostname || p.name}</span>{/if}
				{#if p.local}<span class="local-tag">local</span>{/if}
				<span class="badge {badge.cls}">{badge.label}</span>
			</div>
			{#if p.health}
				<div class="peer-meta">
					<span title="Version">{p.health.version || '?'}</span>
					<span title="Uptime">{fmtDuration(p.health.uptime / 60)}</span>
					{#if p.health.claudeAuthed}<span class="authed" title="Claude authenticated">Authed</span>{/if}
				</div>
				{#if s?.active}
					<div class="session-info">
						<div class="stat"><span class="label">Session</span>{#if p.local}<a class="val session-link" href="/sessions/{s.sessionId}">{s.sessionId?.slice(0, 8)}</a>{:else}<span class="val">{s.sessionId?.slice(0, 8) || '--'}</span>{/if}</div>
						<div class="stat"><span class="label">Duration</span><span class="val">{fmtDuration(s.durationMin)}</span></div>
						<div class="stat"><span class="label">Turns</span><span class="val">{s.turns ?? '--'}</span></div>
						<div class="stat"><span class="label">Context</span><span class="val ctx" class:ctx-warn={s.contextPct > 60} class:ctx-danger={s.contextPct > 80}>{fmtContext(s.contextPct)}</span></div>
					</div>
					{#if s.topTools && Object.keys(s.topTools).length}
						{@const tools = Object.entries(s.topTools).slice(0, 6)}
						<div class="tools">
							{#each tools as [name, count]}
								<span class="tool-chip">{name.replace('mcp__','').replace('computer-use__','')} <small>x{count}</small></span>
							{/each}
							{#if Object.keys(s.topTools).length > 6}<span class="tool-chip muted">+{Object.keys(s.topTools).length - 6}</span>{/if}
						</div>
					{/if}
					{#if s.filesModified?.length}
						<div class="activity">
							{#each s.filesModified.slice(0, 3) as f}
								<div class="activity-line">{f.split('/').slice(-2).join('/')}</div>
							{/each}
						</div>
					{/if}
				{:else}
					<p class="muted no-session">No active session</p>
				{/if}
			{:else}
				<p class="muted no-session">Could not reach this machine</p>
			{/if}
		</div>
	{/each}
</div>
{#if lastRefresh}<p class="refresh-note">Updated {lastRefresh.toLocaleTimeString()}</p>{/if}
{/if}

<style>
	h1 { margin-bottom: 0.5em; }
	.fleet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1em; }
	.peer-card {
		background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
		padding: 1em; transition: border-color 0.2s;
	}
	.peer-card:hover { border-color: var(--link); }
	.peer-card.unreachable { opacity: 0.6; }
	.peer-header { display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em; }
	.peer-name { font-weight: 700; font-size: 1.1em; color: var(--text); text-decoration: none; }
	a.peer-name:hover { color: var(--link); }
	.local-tag { font-size: 0.7em; background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 4px; color: var(--text-muted); }
	.badge { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 10px; font-weight: 600; margin-left: auto; }
	.badge.ok { background: var(--success); color: white; }
	.badge.warn { background: var(--warning); color: #333; }
	.badge.off { background: var(--text-muted); color: white; }
	.badge.down { background: var(--error); color: white; }
	.peer-meta { display: flex; gap: 1em; font-size: 0.8em; color: var(--text-muted); margin-bottom: 0.75em; }
	.authed { color: var(--success); }
	.session-info { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35em 1em; margin-bottom: 0.5em; }
	.stat { display: flex; justify-content: space-between; }
	.label { color: var(--text-muted); font-size: 0.85em; }
	.val { font-weight: 600; font-size: 0.9em; }
	.session-link { color: var(--link); text-decoration: none; }
	.session-link:hover { text-decoration: underline; }
	.ctx-warn { color: var(--warning); }
	.ctx-danger { color: var(--error); }
	.tools { display: flex; flex-wrap: wrap; gap: 0.3em; margin-bottom: 0.5em; }
	.tool-chip { font-size: 0.72em; background: var(--code-bg); padding: 0.15em 0.45em; border-radius: 4px; }
	.tool-chip small { color: var(--text-muted); }
	.activity { font-size: 0.78em; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 0.4em; }
	.activity-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.no-session { font-size: 0.85em; margin: 0.5em 0 0; }
	.muted { color: var(--text-muted); }
	.error { color: var(--error); }
	.refresh-note { font-size: 0.75em; color: var(--text-muted); text-align: right; margin-top: 0.5em; }
</style>

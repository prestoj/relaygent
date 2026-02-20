<script>
	let { data } = $props();
	function fmtTokens(n) {
		if (!n) return '0';
		if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
		if (n >= 1000) return `${(n/1000).toFixed(0)}K`;
		return String(n);
	}
	const st = data.stats;
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

{#if data.sessions.length === 0}
	<p style="color: var(--text-muted)">No sessions found.</p>
{:else}
	<ul class="session-list">
		{#each data.sessions as s, i}
			<li class:current={i === 0}>
				<a href="/sessions/{s.id}">{s.displayTime}</a>
				<span class="meta">
					{#if s.durationMin != null}{s.durationMin}m · {/if}{#if s.totalTokens != null}{fmtTokens(s.totalTokens)} tok · {/if}{#if s.toolCalls != null}{s.toolCalls} tools{/if}{i === 0 ? ' · current' : ''}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h1 { margin-top: 0; }
	.stats-row { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: center; margin-bottom: 1em;
		font-size: 0.85em; color: var(--text-muted); }
	.stats-row strong { color: var(--text); }
	.sep { color: var(--border); }
	.session-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.3em; }
	.session-list li { display: flex; align-items: baseline; gap: 0.75em; }
	.session-list a { font-family: monospace; font-size: 1.05em; }
	.meta { font-size: 0.8em; color: var(--text-muted); }
	.current a { font-weight: 600; }
</style>

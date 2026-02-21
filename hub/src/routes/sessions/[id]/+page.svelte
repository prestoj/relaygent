<script>
	let { data } = $props();
	let expanded = $state(new Set());
	let aiSummary = $state('');
	let summaryLoading = $state(false);
	async function fetchSummary() {
		if (summaryLoading) return;
		summaryLoading = true; aiSummary = '';
		try { const d = await (await fetch(`/api/summary?session=${data.id}`)).json(); aiSummary = d.summary || d.error || 'No summary available'; }
		catch { aiSummary = 'Failed to generate summary'; }
		summaryLoading = false;
	}
	function toggle(i) {
		const s = new Set(expanded);
		s.has(i) ? s.delete(i) : s.add(i);
		expanded = s;
	}
	function fmtTime(iso) {
		if (!iso) return '';
		try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
		catch { return ''; }
	}
	function fmtTokens(n) {
		if (!n) return '0';
		if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
		if (n >= 1000) return `${(n/1000).toFixed(0)}K`;
		return String(n);
	}
	const toolIcons = {
		Bash: '⌨', Read: '📄', Edit: '✏️', Write: '💾', Grep: '🔍', Glob: '📂',
		TodoWrite: '✅', WebFetch: '🌐', WebSearch: '🔎', Task: '🤖',
	};
	function icon(name) {
		if (name in toolIcons) return toolIcons[name];
		if (name.startsWith('mcp__')) return '🔌';
		return '🔧';
	}
	const act = data.activity || [];
	const st = data.stats || {};
	const topTools = Object.entries(st.tools || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
</script>

<svelte:head><title>Session {data.displayTime} — Relaygent</title></svelte:head>

<div class="header">
	<a href="/sessions" class="back">← Sessions</a>
	<h1>Session {data.displayTime}</h1>
</div>

{#if st.durationMin != null || st.totalTokens}
<div class="stats-row">
	{#if st.durationMin != null}<span class="stat"><strong>{st.durationMin}m</strong> duration</span><span class="sep">·</span>{/if}
	{#if st.turns}<span class="stat"><strong>{st.turns}</strong> turns</span><span class="sep">·</span>{/if}
	{#if st.toolCalls}<span class="stat"><strong>{st.toolCalls}</strong> tool calls</span><span class="sep">·</span>{/if}
	{#if st.totalTokens}<span class="stat"><strong>{fmtTokens(st.totalTokens)}</strong> tokens in</span><span class="sep">·</span>{/if}
	{#if st.outputTokens}<span class="stat"><strong>{fmtTokens(st.outputTokens)}</strong> out</span>{/if}
</div>
{/if}

{#if topTools.length > 0}
<div class="tool-bar">{#each topTools as [name, count], i}{#if i > 0}<span class="sep">·</span>{/if}<span class="tb">{icon(name)} {name} <strong>{count}</strong></span>{/each}</div>
{/if}

{#if data.summary}<p class="sum">{data.summary}</p>{/if}
<div class="sum-row">
	<button class="sum-btn" onclick={fetchSummary} disabled={summaryLoading}>{summaryLoading ? 'Generating...' : 'AI Summary'}</button>
	{#if aiSummary}<p class="ai-sum">{aiSummary}</p>{/if}
</div>

{#if !data.activity || data.activity.length === 0}
	<p style="color: var(--text-muted)">No activity recorded for this session.</p>
{:else}
	<p class="count">{data.activity.length} events</p>
	<div class="feed">
		{#each data.activity as item, i}
			{#if item.type === 'text'}
				<div class="entry text-entry">
					<span class="time">{fmtTime(item.time)}</span>
					<span class="text-preview">{item.text.slice(0, 200)}{item.text.length > 200 ? '…' : ''}</span>
				</div>
			{:else if item.type === 'tool'}
				<div class="entry tool-entry" class:open={expanded.has(i)}>
					<button class="tool-row" onclick={() => toggle(i)}>
						<span class="time">{fmtTime(item.time)}</span>
						<span class="tool-icon">{icon(item.name)}</span>
						<span class="tool-name">{item.name}</span>
						<span class="tool-input">{item.input}</span>
						<span class="chevron">{expanded.has(i) ? '▲' : '▼'}</span>
					</button>
					{#if expanded.has(i) && item.fullResult}
						<pre class="result">{item.fullResult.slice(0, 2000)}{item.fullResult.length > 2000 ? '\n…(truncated)' : ''}</pre>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.header { display: flex; align-items: baseline; gap: 1em; margin-bottom: 0.5em; }
	h1 { margin: 0; font-size: 1.4em; }
	.back { font-size: 0.9em; color: var(--text-muted); white-space: nowrap; }
	.stats-row { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: center; margin-bottom: 0.5em; font-size: 0.85em; color: var(--text-muted); }
	.stats-row strong { color: var(--text); }
	.sep { color: var(--border); }
	.tool-bar { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: center; margin-bottom: 0.75em; font-size: 0.8em; color: var(--text-muted); }
	.tb strong { color: var(--text); }
	.sum { margin: 0 0 0.75em; font-size: 0.82em; color: var(--text-muted); }
	.count { color: var(--text-muted); font-size: 0.85em; margin: 0 0 1em; }
	.feed { display: flex; flex-direction: column; gap: 2px; }
	.entry { border-radius: 4px; overflow: hidden; }
	.time { font-size: 0.75em; color: var(--text-muted); min-width: 6em; font-family: monospace; }
	.text-entry { padding: 0.4em 0.5em; background: var(--bg-surface); border: 1px solid var(--border); }
	.text-preview { font-size: 0.85em; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
	.tool-entry { border: 1px solid var(--border); }
	.tool-row { width: 100%; display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.5em; background: var(--bg-surface); border: none; cursor: pointer; text-align: left; color: var(--text); font-size: 0.85em; }
	.tool-row:hover { background: var(--code-bg); }
	.tool-name { font-weight: 600; min-width: 7em; }
	.tool-input { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-family: monospace; font-size: 0.9em; }
	.chevron { font-size: 0.7em; color: var(--text-muted); margin-left: auto; flex-shrink: 0; }
	.result { margin: 0; padding: 0.5em; font-size: 0.8em; background: var(--code-bg); border-top: 1px solid var(--border); max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
	.sum-row { margin-bottom: 0.75em; }
	.sum-btn { padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.8em; font-weight: 600; color: var(--text-muted); }
	.sum-btn:hover:not(:disabled) { border-color: var(--link); color: var(--link); }  .sum-btn:disabled { opacity: 0.6; cursor: wait; }
	.ai-sum { margin: 0.4em 0 0; padding: 0.5em 0.7em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.82em; line-height: 1.5; }
</style>

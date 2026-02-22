<script>
	import { itemKey, fmtTime, fmtTokens, toolCategory as cat, shortName, fmtParams } from '$lib/sessionUtils.js';
	import { sanitizeHtml } from '$lib/sanitize.js';
	import { marked } from 'marked';
	let { data } = $props();
	let expandedKey = $state(null);
	let aiSummary = $state('');
	let summaryLoading = $state(false);
	let filter = $state('all');

	const filters = [
		{ key: 'all', label: 'All' }, { key: 'file', label: 'Files' },
		{ key: 'bash', label: 'Bash' }, { key: 'mcp', label: 'MCP' }, { key: 'text', label: 'Text' },
	];

	async function fetchSummary() {
		if (summaryLoading) return;
		summaryLoading = true; aiSummary = '';
		try { const d = await (await fetch(`/api/summary?session=${data.id}`)).json(); aiSummary = d.summary || d.error || 'No summary available'; }
		catch { aiSummary = 'Failed to generate summary'; }
		summaryLoading = false;
	}

	const act = data.activity || [];
	const st = data.stats || {};
	const topTools = Object.entries(st.tools || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);

	let filtered = $derived(filter === 'all' ? act : act.filter(a =>
		filter === 'text' ? a.type === 'text' : a.type === 'tool' && cat(a.name) === filter));
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
<div class="tool-bar">{#each topTools as [name, count], i}{#if i > 0}<span class="sep">·</span>{/if}<span class="tb">{name} <strong>{count}</strong></span>{/each}</div>
{/if}

{#if data.summary}<p class="sum">{data.summary}</p>{/if}
<div class="sum-row">
	<button class="sum-btn" onclick={fetchSummary} disabled={summaryLoading}>{summaryLoading ? 'Generating...' : 'AI Summary'}</button>
	<a href="/api/sessions/export?id={data.id}" class="sum-btn export-btn" download>Export</a>
	{#if aiSummary}<div class="ai-sum">{@html sanitizeHtml(marked.parse(aiSummary))}</div>{/if}
</div>

{#if !act.length}
	<p style="color: var(--text-muted)">No activity recorded for this session.</p>
{:else}
	<div class="fbar">
		{#each filters as f}<button class="fb" class:active={filter === f.key} onclick={() => filter = f.key}>{f.label}</button>{/each}
		<span class="cnt">{filtered.length}</span>
	</div>
	<div class="feed">
		{#each filtered as item, i (itemKey(item, i))}
			{@const expanded = expandedKey === itemKey(item, i)}
			<div class="ai {item.type} {cat(item.name)}" class:expanded
				onclick={() => expandedKey = expanded ? null : itemKey(item, i)}>
				<span class="time">{fmtTime(item.time)}</span>
				{#if item.type === 'tool'}
					<div class="tc">
						<span class="tn">{item.name?.startsWith('mcp__') ? shortName(item.name) : item.name}</span>
						{#if item.input && !expanded}<span class="ti">{item.input.length > 70 ? item.input.slice(0, 70) + '...' : item.input}</span>{/if}
					</div>
					{#if expanded}
						<div class="detail" style="grid-column: 2">
							{#if item.params && Object.keys(item.params).length}
								<div class="detail-section">
									<span class="detail-label">Params</span>
									<pre class="detail-pre">{fmtParams(item.params)}</pre>
								</div>
							{/if}
							{#if item.fullResult || item.result}
								<div class="detail-section">
									<span class="detail-label">Result</span>
									<pre class="detail-pre">{(item.fullResult || item.result).slice(0, 2000)}{(item.fullResult || item.result).length > 2000 ? '\n…(truncated)' : ''}</pre>
								</div>
							{/if}
							{#if !item.params && !item.result && !item.fullResult}
								<span class="detail-empty">No details available</span>
							{/if}
						</div>
					{/if}
				{:else}
					<span class="tx">{expanded ? item.text : (item.text.length > 200 ? item.text.slice(0, 200) + '...' : item.text)}</span>
				{/if}
			</div>
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
	.sum-row { margin-bottom: 0.75em; }
	.sum-btn { padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.8em; font-weight: 600; color: var(--text-muted); }
	.sum-btn:hover:not(:disabled) { border-color: var(--link); color: var(--link); }  .sum-btn:disabled { opacity: 0.6; cursor: wait; }
	.export-btn { text-decoration: none; display: inline-block; }
	.ai-sum { margin: 0.4em 0 0; padding: 0.5em 0.7em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.82em; line-height: 1.5; color: var(--text); }
	.ai-sum :global(ul), .ai-sum :global(ol) { margin: 0.3em 0; padding-left: 1.5em; }
	.ai-sum :global(li) { margin: 0.15em 0; }
	.ai-sum :global(p) { margin: 0.3em 0; } .ai-sum :global(p:first-child) { margin-top: 0; } .ai-sum :global(p:last-child) { margin-bottom: 0; }
	.ai-sum :global(strong) { color: var(--text); }
	.fbar { display: flex; gap: 0.3em; align-items: center; margin-bottom: 0.5em; }
	.fb { padding: 0.2em 0.5em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-size: 0.78em; }
	.fb.active { background: var(--link); color: white; border-color: var(--link); }
	.cnt { margin-left: auto; font-size: 0.78em; color: var(--text-muted); }
	.feed { display: flex; flex-direction: column; gap: 0.25em; }
	.ai { display: grid; grid-template-columns: 3.5em 1fr; gap: 0.4em; font-size: 0.85em; padding: 0.35em 0.5em; background: var(--bg-surface); border-radius: 4px; border-left: 3px solid var(--border); cursor: pointer; transition: background 0.15s; }
	.ai:hover { background: var(--code-bg); }
	.ai.expanded { background: var(--code-bg); }
	.ai.text { border-left-color: var(--success); }
	.ai.file { border-left-color: #3b82f6; }
	.ai.bash { border-left-color: var(--warning); }
	.ai.mcp { border-left-color: #8b5cf6; }
	.ai.other { border-left-color: #6b7280; }
	.time { color: var(--text-muted); font-size: 0.78em; font-family: monospace; white-space: nowrap; }
	.tc { display: flex; flex-wrap: wrap; gap: 0.3em; align-items: baseline; min-width: 0; }
	.tn { font-weight: 600; font-family: monospace; white-space: nowrap; font-size: 0.92em; }
	.file .tn { color: #3b82f6; } .bash .tn { color: #f59e0b; } .mcp .tn { color: #8b5cf6; } .other .tn { color: #6b7280; }
	.ti { color: var(--text-muted); font-family: monospace; font-size: 0.88em; word-break: break-word; }
	.tx { color: var(--text); line-height: 1.4; min-width: 0; word-break: break-word; }
	.detail { margin-top: 0.3em; }
	.detail-section { margin-bottom: 0.4em; }
	.detail-label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; }
	.detail-pre { margin: 0.15em 0 0; padding: 0.4em 0.6em; background: var(--bg); border-radius: 4px; font-size: 0.82em; white-space: pre-wrap; word-break: break-word; color: var(--text); border: 1px solid var(--border); max-height: 300px; overflow-y: auto; }
	.detail-empty { font-size: 0.8em; color: var(--text-muted); font-style: italic; }
</style>

<script>
	import { itemKey, fmtTime, fmtTokens, toolCategory as cat, shortName, fmtParams } from '$lib/sessionUtils.js';
	let { data } = $props();
	let expandedKey = $state(null);
	let aiSummary = $state('');
	let summaryLoading = $state(false);
	let filter = $state('all');
	let query = $state('');

	const filters = [
		{ key: 'all', label: 'All' }, { key: 'file', label: 'Files' },
		{ key: 'bash', label: 'Bash' }, { key: 'mcp', label: 'MCP' }, { key: 'text', label: 'Text' },
	];

	const act = data.activity || [];
	const st = data.stats || {};
	const topTools = Object.entries(st.tools || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);

	const filesTouched = (() => {
		const files = new Map();
		for (const a of act) {
			if (a.type !== 'tool' || !a.params) continue;
			const p = a.params.file_path || a.params.path || a.params.pattern;
			if (!p || typeof p !== 'string' || p.length < 2) continue;
			const op = { Read: 'read', Glob: 'search', Grep: 'search', Edit: 'modified', Write: 'modified' }[a.name];
			if (!op) continue;
			const cur = files.get(p);
			if (!cur || (op === 'modified' && cur === 'read')) files.set(p, op);
		}
		return [...files.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === 'modified' ? -1 : 1));
	})();

	async function fetchSummary() {
		if (summaryLoading) return;
		summaryLoading = true; aiSummary = '';
		try { const d = await (await fetch(`/api/summary?session=${data.id}`)).json(); aiSummary = d.summary || d.error || 'No summary available'; }
		catch { aiSummary = 'Failed to generate summary'; }
		summaryLoading = false;
	}

	let filtered = $derived.by(() => {
		let list = filter === 'all' ? act : act.filter(a =>
			filter === 'text' ? a.type === 'text' : a.type === 'tool' && cat(a.name) === filter);
		if (query.trim()) {
			const q = query.toLowerCase();
			list = list.filter(a => (a.name || '').toLowerCase().includes(q)
				|| (a.input || '').toLowerCase().includes(q) || (a.text || '').toLowerCase().includes(q)
				|| (a.result || '').toLowerCase().includes(q));
		}
		return list;
	});
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
	{#if aiSummary}<p class="ai-sum">{aiSummary}</p>{/if}
</div>

{#if filesTouched.length > 0}
<details class="files-touched">
	<summary>{filesTouched.length} file{filesTouched.length === 1 ? '' : 's'} touched</summary>
	<ul>{#each filesTouched as [path, op]}<li><span class="fop {op}">{op}</span><span class="fp">{path.split('/').pop()}</span><span class="fdir">{path.split('/').slice(0, -1).join('/')}/</span></li>{/each}</ul>
</details>
{/if}

{#if !act.length}
	<p style="color: var(--text-muted)">No activity recorded for this session.</p>
{:else}
	<div class="fbar">
		{#each filters as f}<button class="fb" class:active={filter === f.key} onclick={() => filter = f.key}>{f.label}</button>{/each}
		<input type="text" class="fsearch" bind:value={query} placeholder="Search..." />
		{#if query}<button class="fclear" onclick={() => query = ''}>x</button>{/if}
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
	.ai-sum { margin: 0.4em 0 0; padding: 0.5em 0.7em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.82em; line-height: 1.5; }
	.fbar { display: flex; gap: 0.3em; align-items: center; margin-bottom: 0.5em; }
	.fb { padding: 0.2em 0.5em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-size: 0.78em; }
	.fb.active { background: var(--link); color: white; border-color: var(--link); }
	.fsearch { margin-left: auto; width: 8em; padding: 0.2em 0.5em; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text); font-size: 0.78em; outline: none; }
	.fsearch:focus { border-color: var(--link); width: 12em; }
	.fclear { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.78em; padding: 0.1em 0.3em; }
	.fclear:hover { color: var(--text); }
	.cnt { font-size: 0.78em; color: var(--text-muted); }
	.files-touched { margin-bottom: 1em; font-size: 0.82em; }
	.files-touched summary { cursor: pointer; font-weight: 600; color: var(--text-muted); }
	.files-touched ul { list-style: none; padding: 0; margin: 0.3em 0 0; display: flex; flex-direction: column; gap: 0.15em; }
	.files-touched li { display: flex; gap: 0.5em; align-items: baseline; font-family: monospace; font-size: 0.9em; }
	.fop { font-size: 0.72em; font-weight: 700; text-transform: uppercase; padding: 0.1em 0.3em; border-radius: 3px; }
	.fop.modified { color: var(--warning); } .fop.read { color: var(--text-muted); } .fop.search { color: #8b5cf6; }
	.fp { font-weight: 600; color: var(--text); } .fdir { color: var(--text-muted); font-size: 0.85em; }
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

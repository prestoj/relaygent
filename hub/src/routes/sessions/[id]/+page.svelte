<script>
	import { fmtTokens } from '$lib/sessionUtils.js';
	import { sanitizeHtml } from '$lib/sanitize.js';
	import { marked } from 'marked';
	import SessionActivityFeed from '$lib/components/SessionActivityFeed.svelte';
	let { data } = $props();
	let aiSummary = $state('');
	let summaryLoading = $state(false);

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
	{#if st.git_commits}<span class="sep">·</span><span class="stat git"><strong>{st.git_commits}</strong> commit{st.git_commits === 1 ? '' : 's'}</span>{/if}
	{#if st.prs_created?.length}<span class="sep">·</span><span class="stat git"><strong>{st.prs_created.length}</strong> PR{st.prs_created.length === 1 ? '' : 's'}</span>{/if}
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

{#if filesTouched.length > 0}
<details class="files-touched">
	<summary>{filesTouched.length} file{filesTouched.length === 1 ? '' : 's'} touched</summary>
	<ul>{#each filesTouched as [path, op]}<li><span class="fop {op}">{op}</span><span class="fp">{path.split('/').pop()}</span><span class="fdir">{path.split('/').slice(0, -1).join('/')}/</span></li>{/each}</ul>
</details>
{/if}

<SessionActivityFeed activity={act} />

<style>
	.header { display: flex; align-items: baseline; gap: 1em; margin-bottom: 0.5em; }
	h1 { margin: 0; font-size: 1.4em; }
	.back { font-size: 0.9em; color: var(--text-muted); white-space: nowrap; }
	.stats-row { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: center; margin-bottom: 0.5em; font-size: 0.85em; color: var(--text-muted); }
	.stats-row strong { color: var(--text); } .stat.git strong { color: #22c55e; }
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
	.files-touched { margin-bottom: 1em; font-size: 0.82em; }
	.files-touched summary { cursor: pointer; font-weight: 600; color: var(--text-muted); }
	.files-touched ul { list-style: none; padding: 0; margin: 0.3em 0 0; display: flex; flex-direction: column; gap: 0.15em; }
	.files-touched li { display: flex; gap: 0.5em; align-items: baseline; font-family: monospace; font-size: 0.9em; }
	.fop { font-size: 0.72em; font-weight: 700; text-transform: uppercase; padding: 0.1em 0.3em; border-radius: 3px; }
	.fop.modified { color: var(--warning); } .fop.read { color: var(--text-muted); } .fop.search { color: #8b5cf6; }
	.fp { font-weight: 600; color: var(--text); } .fdir { color: var(--text-muted); font-size: 0.85em; }
</style>

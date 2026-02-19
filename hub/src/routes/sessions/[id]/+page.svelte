<script>
	let { data } = $props();
	let expanded = $state(new Set());

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

	const toolIcons = {
		Bash: '⌨', Read: '📄', Edit: '✏️', Write: '💾', Grep: '🔍', Glob: '📂',
		TodoWrite: '✅', WebFetch: '🌐', WebSearch: '🔎', Task: '🤖',
	};
	function icon(name) {
		if (name in toolIcons) return toolIcons[name];
		if (name.startsWith('mcp__')) return '🔌';
		return '🔧';
	}
</script>

<svelte:head><title>Session {data.displayTime} — Relaygent</title></svelte:head>

<div class="header">
	<a href="/sessions" class="back">← Sessions</a>
	<h1>Session {data.displayTime}</h1>
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
</style>

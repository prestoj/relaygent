<script>
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { marked } from 'marked';
	import { sanitizeHtml } from '$lib/sanitize.js';
	let open = $state(false);
	let activities = $state([]);
	let connected = $state(false);
	let ws = null;
	let expandedKey = $state(null);
	let now = $state(Date.now());

	function shortName(n) {
		if (!n) return '?';
		if (!n.startsWith('mcp__')) return n;
		const parts = n.replace('mcp__', '').split('__');
		return `${parts[0]}.${(parts[1] || '').replace(`${parts[0]}_`, '')}`;
	}

	function cat(n) {
		if (!n) return 'other';
		if (['Read','Edit','Write','Glob','Grep'].includes(n)) return 'file';
		if (n === 'Bash') return 'bash';
		if (n.startsWith('mcp__')) return 'mcp';
		return 'other';
	}

	$effect(() => { const id = setInterval(() => { now = Date.now(); }, 1000); return () => clearInterval(id); });

	function relTime(ts) {
		const d = Math.floor((now - new Date(ts).getTime()) / 1000);
		if (d < 5) return 'now'; if (d < 60) return `${d}s`; if (d < 3600) return `${Math.floor(d/60)}m`;
		return `${Math.floor(d/3600)}h`;
	}

	function itemKey(item) { return item.toolUseId || `${item.time}-${item.name || item.type}`; }

	function connect() {
		if (!browser) return;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		ws.onopen = () => { connected = true; };
		ws.onclose = () => { connected = false; setTimeout(connect, 3000); };
		ws.onmessage = (event) => {
			let msg; try { msg = JSON.parse(event.data); } catch { return; }
			if (msg.type === 'activity') {
				activities = [{ ...msg.data, isNew: true }, ...activities].slice(0, 80);
				setTimeout(() => { activities = activities.map((a, i) => i === 0 ? { ...a, isNew: false } : a); }, 400);
			} else if (msg.type === 'result' && msg.toolUseId) {
				activities = activities.map(a =>
					a.toolUseId === msg.toolUseId ? { ...a, result: msg.result, fullResult: msg.fullResult } : a
				);
			}
		};
	}

	onMount(() => { if (browser) connect(); });
	onDestroy(() => { if (ws) ws.close(); });
</script>

<button class="sidebar-toggle" class:open onclick={() => open = !open}
	title={open ? 'Hide activity' : 'Show activity'}>
	{open ? '\u25C0' : '\u25B6'}
	{#if !open}<span class="toggle-label">Activity</span>{/if}
	{#if !open && connected}<span class="live-dot"></span>{/if}
</button>

<aside class="sidebar" class:open>
	<div class="sidebar-header">
		<span class="sidebar-title">Activity</span>
		{#if connected}<span class="live-badge">LIVE</span>{/if}
	</div>
	{#if activities.length === 0}
		<div class="sidebar-empty">No activity yet</div>
	{:else}
		<div class="sidebar-feed">
			{#each activities as a (itemKey(a))}
				{@const expanded = expandedKey === itemKey(a)}
				<div class="ai {a.type} {a.type === 'tool' ? cat(a.name) : 'text'}" class:new={a.isNew} class:expanded
					onclick={() => a.type === 'tool' && (expandedKey = expanded ? null : itemKey(a))}>
					<span class="time">{relTime(a.time)}</span>
					{#if a.type === 'tool'}
						<div class="tc">
							<span class="tn">{a.name?.startsWith('mcp__') ? shortName(a.name) : a.name}</span>
							{#if a.input && !expanded}<span class="ti">{a.input.length > 80 ? a.input.slice(0, 80) + '...' : a.input}</span>{/if}
						</div>
						{#if expanded}
							<div class="detail">
								{#if a.input}<pre class="detail-pre">{a.input}</pre>{/if}
								{#if a.fullResult || a.result}
									<pre class="detail-pre result">{a.fullResult || a.result}</pre>
								{/if}
							</div>
						{/if}
					{:else}
						<span class="tx">{@html sanitizeHtml(marked.parse(a.text || ''))}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</aside>

<style>
	.sidebar-toggle {
		position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 200;
		background: var(--bg-surface); border: 1px solid var(--border); border-left: none;
		border-radius: 0 6px 6px 0; padding: 0.5em 0.35em; cursor: pointer;
		color: var(--text-muted); font-size: 0.7em; display: flex; flex-direction: column;
		align-items: center; gap: 0.3em; writing-mode: vertical-lr; transition: left 0.2s ease;
	}
	.sidebar-toggle:hover { color: var(--text); background: var(--code-bg); }
	.sidebar-toggle.open { left: 320px; }
	.toggle-label { font-size: 0.9em; letter-spacing: 0.05em; font-weight: 600; }
	.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success, #22c55e); }

	.sidebar {
		width: 0; flex-shrink: 0; overflow: hidden;
		background: var(--bg); border-right: 1px solid transparent;
		display: flex; flex-direction: column; transition: width 0.2s ease;
	}
	.sidebar.open { width: 320px; border-right-color: var(--border); }
	.sidebar-header {
		display: flex; align-items: center; gap: 0.5em; padding: 0.6em 0.8em;
		border-bottom: 1px solid var(--border); flex-shrink: 0;
	}
	.sidebar-title { font-weight: 700; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; }
	.live-badge { font-size: 0.6em; font-weight: 700; padding: 0.15em 0.4em; border-radius: 4px; background: color-mix(in srgb, var(--success, #22c55e) 15%, transparent); color: var(--success, #22c55e); }
	.sidebar-empty { padding: 2em 0.8em; text-align: center; color: var(--text-muted); font-size: 0.8em; }

	.sidebar-feed { overflow-y: auto; flex: 1; }
	.ai { display: grid; grid-template-columns: auto 1fr; gap: 0 0.5em; padding: 0.4em 0.8em;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		font-size: 0.78em; line-height: 1.4; cursor: default; border-left: 3px solid var(--border); }
	.ai.tool { cursor: pointer; }
	.ai.tool:hover { background: var(--code-bg); }
	.ai.text { border-left-color: var(--success); }
	.ai.file { border-left-color: #3b82f6; }
	.ai.bash { border-left-color: #f59e0b; }
	.ai.mcp { border-left-color: #8b5cf6; }
	.ai.other { border-left-color: #6b7280; }
	.ai.new { animation: fadeIn 0.3s ease; }
	@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; } }
	.time { color: var(--text-muted); font-size: 0.8em; opacity: 0.6; white-space: nowrap; padding-top: 0.1em; }
	.tc { display: flex; flex-wrap: wrap; gap: 0.3em; align-items: baseline; }
	.tn { font-weight: 600; font-family: monospace; font-size: 0.95em; white-space: nowrap; }
	.file .tn { color: #3b82f6; } .bash .tn { color: #f59e0b; } .mcp .tn { color: #8b5cf6; } .other .tn { color: #6b7280; }
	.ti { color: var(--text-muted); font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
	.tx { color: var(--text); word-break: break-word; }
	.tx :global(p) { margin: 0.2em 0; }
	.tx :global(code) { font-size: 0.9em; background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; }
	.tx :global(pre) { background: var(--code-bg); padding: 0.5em; border-radius: 4px; overflow-x: auto; margin: 0.3em 0; }
	.tx :global(pre code) { background: none; padding: 0; }
	.detail { grid-column: 1 / -1; margin-top: 0.3em; }
	.detail-pre { font-size: 0.82em; background: var(--code-bg); padding: 0.4em 0.6em; border-radius: 4px;
		white-space: pre-wrap; word-break: break-all; max-height: 12em; overflow-y: auto; margin: 0.2em 0; }
	.detail-pre.result { color: var(--text-muted); }

	@media (max-width: 800px) {
		.sidebar.open { width: 280px; }
		.sidebar-toggle.open { left: 280px; }
	}
</style>

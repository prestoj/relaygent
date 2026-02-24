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

	function shortName(n) {
		if (!n) return '?';
		if (!n.startsWith('mcp__')) return n;
		const parts = n.replace('mcp__', '').split('__');
		const svc = parts[0];
		const op = (parts[1] || '').replace(`${parts[0]}_`, '');
		return `${svc}.${op}`;
	}

	function relTime(ts) {
		const d = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
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
	{open ? '\u25B6' : '\u25C0'}
	{#if !open}<span class="toggle-label">Activity</span>{/if}
	{#if !open && connected}<span class="live-dot"></span>{/if}
</button>

{#if open}
<aside class="sidebar">
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
				<div class="ai {a.type}" class:new={a.isNew} class:expanded
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
{/if}

<style>
	.sidebar-toggle {
		position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 200;
		background: var(--bg-surface); border: 1px solid var(--border); border-right: none;
		border-radius: 6px 0 0 6px; padding: 0.5em 0.35em; cursor: pointer;
		color: var(--text-muted); font-size: 0.7em; display: flex; flex-direction: column;
		align-items: center; gap: 0.3em; writing-mode: vertical-lr;
	}
	.sidebar-toggle:hover { color: var(--text); background: var(--code-bg); }
	.sidebar-toggle.open { right: 320px; }
	.toggle-label { font-size: 0.9em; letter-spacing: 0.05em; font-weight: 600; }
	.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success, #22c55e); }

	.sidebar {
		position: fixed; right: 0; top: 0; bottom: 0; width: 320px; z-index: 199;
		background: var(--bg); border-left: 1px solid var(--border);
		display: flex; flex-direction: column; overflow: hidden;
		box-shadow: -2px 0 8px rgba(0,0,0,0.08);
	}
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
		font-size: 0.78em; line-height: 1.4; cursor: default; }
	.ai.tool { cursor: pointer; }
	.ai.tool:hover { background: var(--code-bg); }
	.ai.new { animation: fadeIn 0.3s ease; }
	@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; } }
	.time { color: var(--text-muted); font-size: 0.8em; opacity: 0.6; white-space: nowrap; padding-top: 0.1em; }
	.tc { display: flex; flex-wrap: wrap; gap: 0.3em; align-items: baseline; }
	.tn { font-weight: 600; color: var(--link); font-family: monospace; font-size: 0.95em; }
	.ti { color: var(--text-muted); font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
	.tx { color: var(--text); word-break: break-word; }
	.tx :global(p) { margin: 0.2em 0; }
	.tx :global(code) { font-size: 0.9em; background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; }
	.detail { grid-column: 1 / -1; margin-top: 0.3em; }
	.detail-pre { font-size: 0.82em; background: var(--code-bg); padding: 0.4em 0.6em; border-radius: 4px;
		white-space: pre-wrap; word-break: break-all; max-height: 12em; overflow-y: auto; margin: 0.2em 0; }
	.detail-pre.result { color: var(--text-muted); }

	@media (max-width: 800px) {
		.sidebar { width: 280px; }
		.sidebar-toggle.open { right: 280px; }
	}
</style>

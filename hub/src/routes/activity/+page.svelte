<script>
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { marked } from 'marked';
	import { sanitizeHtml } from '$lib/sanitize.js';
	let activities = $state([]);
	let connected = $state(false);
	let ws = null;
	let expandedKey = $state(null);
	let now = $state(Date.now());
	let contextPct = $state(0);
	let hasMore = $state(true);
	let loading = $state(false);
	let historyOffset = 0;
	let seenKeys = new Set();

	async function fetchContext() {
		try { const r = await fetch('/api/session/live'); if (r.ok) { const d = await r.json(); contextPct = d.contextPct || 0; } } catch {}
	}

	async function loadHistory() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const r = await fetch(`/api/session/activity?offset=${historyOffset}&limit=30`);
			if (r.ok) {
				const d = await r.json();
				const fresh = d.items.filter(i => !seenKeys.has(itemKey(i)));
				fresh.forEach(i => seenKeys.add(itemKey(i)));
				activities = [...activities, ...fresh];
				historyOffset += d.items.length; hasMore = d.hasMore !== false;
			}
		} catch {}
		loading = false;
	}

	function onFeedScroll(e) { const el = e.target; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) loadHistory(); }

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
				const item = { ...msg.data, isNew: true };
				const key = itemKey(item);
				if (seenKeys.has(key)) return;
				seenKeys.add(key);
				activities = [item, ...activities];
				setTimeout(() => { activities = activities.map((a, i) => i === 0 ? { ...a, isNew: false } : a); }, 400);
			} else if (msg.type === 'result' && msg.toolUseId) {
				activities = activities.map(a =>
					a.toolUseId === msg.toolUseId ? { ...a, result: msg.result, fullResult: msg.fullResult } : a
				);
			}
		};
	}

	onMount(() => { if (browser) { connect(); loadHistory(); fetchContext(); setInterval(fetchContext, 8000); } });
	onDestroy(() => { if (ws) ws.close(); });
</script>

<svelte:head><title>Relaygent · Activity</title></svelte:head>

<div class="activity-page">
	<div class="activity-header">
		<span class="activity-title">Activity</span>
		{#if connected}<span class="live-badge">LIVE</span>{/if}
	</div>
	{#if contextPct > 0}<div class="context-bar"><div class="context-fill" style="width: {contextPct}%; background: {contextPct > 80 ? 'var(--error)' : contextPct > 60 ? 'var(--warning)' : 'var(--success)'}"></div></div>{/if}
	{#if activities.length === 0}
		<div class="activity-empty">No activity yet</div>
	{:else}
		<div class="activity-feed" onscroll={onFeedScroll}>
			{#each activities as a (itemKey(a))}
				{@const expanded = expandedKey === itemKey(a)}
				<div class="ai {a.type} {a.type === 'tool' ? cat(a.name) : 'text'}" class:new={a.isNew} class:expanded
					onclick={() => a.type === 'tool' && (expandedKey = expanded ? null : itemKey(a))}>
					<span class="time">{relTime(a.time)}</span>
					{#if a.type === 'tool'}
						<div class="tc">
							<span class="tn">{a.name?.startsWith('mcp__') ? shortName(a.name) : a.name}</span>
							{#if a.input && !expanded}<span class="ti">{a.input.length > 120 ? a.input.slice(0, 120) + '...' : a.input}</span>{/if}
						</div>
						{#if expanded}
							<div class="detail">
								{#if a.input}<pre class="detail-pre">{a.input}</pre>{/if}
								{#if a.fullResult || a.result}<pre class="detail-pre result">{a.fullResult || a.result}</pre>{/if}
							</div>
						{/if}
					{:else}
						<span class="tx">{@html sanitizeHtml(marked.parse(a.text || ''))}</span>
					{/if}
				</div>
			{/each}
			{#if loading}<div class="load-more">Loading...</div>{/if}
		</div>
	{/if}
</div>

<style>
	.activity-page { display: flex; flex-direction: column; height: 100%; max-width: 900px; margin: 0 auto; width: 100%; }
	.activity-header { display: flex; align-items: center; gap: 0.5em; padding: 0.8em 1em; border-bottom: 1px solid var(--border); flex-shrink: 0; }
	.activity-title { font-weight: 700; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; }
	.live-badge { font-size: 0.6em; font-weight: 700; padding: 0.15em 0.4em; border-radius: 4px; background: color-mix(in srgb, var(--success, #22c55e) 15%, transparent); color: var(--success, #22c55e); }
	.activity-empty { padding: 3em 1em; text-align: center; color: var(--text-muted); font-size: 0.9em; }
	.context-bar { height: 3px; background: var(--code-bg); flex-shrink: 0; }
	.context-fill { height: 100%; transition: width 1s ease; border-radius: 0 2px 2px 0; }
	.activity-feed { overflow-y: auto; flex: 1; }
	.ai { display: grid; grid-template-columns: 2.5em 1fr; gap: 0 0.5em; padding: 0.5em 1em;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		font-size: 0.85em; line-height: 1.4; cursor: default; border-left: 3px solid var(--border); }
	.ai.tool { cursor: pointer; }
	.ai.tool:hover { background: var(--code-bg); }
	.ai.text { border-left-color: var(--success); }
	.ai.file { border-left-color: #3b82f6; }
	.ai.bash { border-left-color: #f59e0b; }
	.ai.mcp { border-left-color: #8b5cf6; }
	.ai.other { border-left-color: #6b7280; }
	.ai.new { animation: fadeIn 0.3s ease; }
	@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; } }
	.time { color: var(--text-muted); font-size: 0.8em; opacity: 0.6; white-space: nowrap; padding-top: 0.1em; text-align: right; }
	.tc { display: flex; flex-wrap: wrap; gap: 0.3em; align-items: baseline; min-width: 0; }
	.tn { font-weight: 600; font-family: monospace; font-size: 0.95em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.file .tn { color: #3b82f6; } .bash .tn { color: #f59e0b; } .mcp .tn { color: #8b5cf6; } .other .tn { color: #6b7280; }
	.ti { color: var(--text-muted); font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
	.tx { color: var(--text); word-break: break-word; }
	.tx :global(p) { margin: 0.2em 0; }
	.tx :global(code) { font-size: 0.9em; background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; }
	.tx :global(pre) { background: var(--code-bg); padding: 0.5em; border-radius: 4px; overflow-x: auto; margin: 0.3em 0; }
	.tx :global(pre code) { background: none; padding: 0; }
	.detail { grid-column: 1 / -1; margin-top: 0.3em; }
	.detail-pre { font-size: 0.82em; background: var(--code-bg); padding: 0.4em 0.6em; border-radius: 4px;
		white-space: pre-wrap; word-break: break-all; max-height: 16em; overflow-y: auto; margin: 0.2em 0; }
	.detail-pre.result { color: var(--text-muted); }
	.load-more { text-align: center; padding: 0.5em; color: var(--text-muted); font-size: 0.8em; }
</style>

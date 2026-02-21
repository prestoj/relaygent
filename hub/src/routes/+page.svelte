<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import ContextBar from '$lib/components/ContextBar.svelte';
	import ActivityFeed from '$lib/components/ActivityFeed.svelte';
	import ScreenStream from '$lib/components/ScreenStream.svelte';
	import { sanitizeHtml } from '$lib/sanitize.js';
	import { marked } from 'marked';
	import SessionTimer from '$lib/components/SessionTimer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import TodoWidget from '$lib/components/TodoWidget.svelte';
	import WelcomeCard from '$lib/components/WelcomeCard.svelte';
	import PrWidget from '$lib/components/PrWidget.svelte';
	import NotificationsWidget from '$lib/components/NotificationsWidget.svelte';
	let { data } = $props();
	let screenOpen = $state(false);
	let activities = $state(data.relayActivity || []);
	let connected = $state(false);
	let contextPct = $state(data.contextPct);
	let attentionItems = $state(data.attentionItems || []);
	let sessionStatus = $state(data.relayActivity?.length > 0 ? 'found' : 'waiting');
	let ws = null, svcInterval;
	let loading = $state(false), hasMore = $state(true);
	let hookCtx = $state('');
	let services = $state(data.services || []);
	let relayRunning = $state(data.relayRunning ?? true);
	let summaryText = $state('');
	let summaryLoading = $state(false);
	async function fetchSummary() {
		if (summaryLoading) return;
		summaryLoading = true; summaryText = '';
		try { const d = await (await fetch('/api/summary?session=current')).json(); summaryText = d.summary || d.error || 'No summary available'; }
		catch { summaryText = 'Failed to generate summary'; }
		summaryLoading = false;
	}
	async function toggleRelay() {
		const action = relayRunning ? 'stop' : 'start';
		try { const r = await fetch('/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); if (r.ok) relayRunning = !relayRunning; } catch { /* ignore */ }
	}

	async function refreshServices() { try { const d = await (await fetch('/api/services')).json(); services = d.services || []; } catch { /* ignore */ } }

	async function reloadPageData() {
		try { const d = await (await fetch(`/api/relay?offset=0&limit=50`)).json(); if (d.activities?.length > 0) activities = d.activities; } catch { /* ignore */ }
	}

	function connect() {
		if (!browser) return;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		ws.onopen = () => { connected = true; };
		ws.onclose = () => { connected = false; setTimeout(connect, 3000); };
		ws.onmessage = (event) => {
			let msg; try { msg = JSON.parse(event.data); } catch { return; }
			if (msg.type === 'activity') {
				sessionStatus = 'found';
				activities = [{ ...msg.data, isNew: true }, ...activities].slice(0, 100);
				setTimeout(() => { activities = activities.map((a, i) => i === 0 ? { ...a, isNew: false } : a); }, 500);
			} else if (msg.type === 'result' && msg.toolUseId) {
				activities = activities.map(a => a.toolUseId === msg.toolUseId ? { ...a, result: msg.result, fullResult: msg.fullResult } : a);
			} else if (msg.type === 'context') { contextPct = msg.pct; }
			else if (msg.type === 'hook') { hookCtx = msg.data?.context || ''; }
			else if (msg.type === 'session') {
				sessionStatus = msg.status;
				if (msg.status === 'found') reloadPageData();
			}
		};
	}

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const d = await (await fetch(`/api/relay?offset=${activities.length}&limit=20`)).json();
			if (d.activities.length > 0) activities = [...activities, ...d.activities];
			hasMore = d.hasMore;
		} catch (e) { console.error('Load failed:', e); }
		loading = false;
	}

	function handleScroll() { const { scrollTop, scrollHeight, clientHeight } = document.documentElement; if (scrollTop + clientHeight >= scrollHeight - 200) loadMore(); }
	onMount(() => { connect(); if (browser) { window.addEventListener('scroll', handleScroll); svcInterval = setInterval(refreshServices, 30000); } });
	onDestroy(() => { if (ws) ws.close(); clearInterval(svcInterval); if (browser) window.removeEventListener('scroll', handleScroll); });
	function clearAttentionItem(index) { attentionItems = attentionItems.filter((_, i) => i !== index); }
	function clearAllAttention() { attentionItems = []; }
</script>

<svelte:head><title>Relaygent</title></svelte:head>

<StatusBar {connected} {relayRunning} {services} onToggleRelay={toggleRelay} />

{#if hookCtx}
<div class="hook-ctx"><span class="hook-label">Agent context</span>{hookCtx}</div>
{/if}

{#if data.currentTasks?.length}
<section class="goal">
	<div class="gl">Current</div>
	<div class="gt">{#each data.currentTasks as task, i}{#if i > 0} · {/if}<span class="task-id">{task.identifier}</span> {task.title}{#if task.assignee} <span class="task-assignee">({task.assignee})</span>{/if}{/each}</div>
</section>
{/if}


<ContextBar pct={contextPct} />
<SessionTimer sessionId={services?.find(s => s.name === 'Relay')?.sessionId} />
<TodoWidget {activities} />
<NotificationsWidget />
<PrWidget />
<section class="screen-toggle">
	<button class="toggle-btn" onclick={() => screenOpen = !screenOpen}>
		<span class="toggle-arrow">{screenOpen ? '\u25BC' : '\u25B6'}</span>
		Screen
	</button>
	{#if screenOpen}
		<div class="screen-wrap"><ScreenStream fps={4} /></div>
	{/if}
</section>

{#if sessionStatus === 'found'}
<section class="summary-section">
	<div class="summary-hdr">
		<button class="summary-btn" onclick={fetchSummary} disabled={summaryLoading}>{summaryLoading ? 'Generating...' : "What's happening?"}</button>
		{#if summaryText}<button class="summary-dismiss" onclick={() => summaryText = ''}>Dismiss</button>{/if}
	</div>
	{#if summaryText}<div class="summary-text">{@html sanitizeHtml(marked.parse(summaryText))}</div>{/if}
</section>
{/if}

{#if attentionItems?.length > 0}
<section class="attention">
	<div class="att-hdr"><h3>Attention</h3><button class="clear-all" onclick={clearAllAttention}>Clear</button></div>
	{#each attentionItems as item, i}
		<div class="att-item"><span>{@html sanitizeHtml(item)}</span><button class="x" onclick={() => clearAttentionItem(i)}>x</button></div>
	{/each}
</section>
{/if}

{#if sessionStatus === 'waiting' && activities.length === 0}
<section class="waiting">
	{#if relayRunning}
		<div class="waiting-icon">&#9203;</div>
		<div class="waiting-text">Agent is starting up...</div>
		<div class="waiting-hint">The dashboard will update automatically when the agent begins working.</div>
	{:else}
		<WelcomeCard />
	{/if}
</section>
{:else}
<ActivityFeed {activities} {loading} {hasMore} onLoadMore={loadMore} />
{/if}

<style>
	.hook-ctx { font-size: 0.72em; color: var(--text-muted); padding: 0.3em 1em; background: var(--code-bg); border-radius: 6px; margin-bottom: 0.75em; font-family: monospace; white-space: pre-wrap; word-break: break-word; }
	.hook-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-right: 0.6em; font-size: 0.9em; }
	.goal { display: flex; align-items: baseline; gap: 0.75em; padding: 0.5em 1em; background: color-mix(in srgb, var(--link) 8%, var(--bg-surface)); border: 1px solid color-mix(in srgb, var(--link) 25%, var(--border)); border-radius: 8px; margin-bottom: 1em; }
	.gl { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--link); white-space: nowrap; }  .gt { color: var(--text); font-size: 0.88em; line-height: 1.4; }
	.task-id { font-family: monospace; font-size: 0.9em; font-weight: 600; color: var(--link); }  .task-assignee { color: var(--text-muted); font-size: 0.9em; }
	.attention { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.75em 1em; margin-bottom: 1em; }  .att-hdr { display: flex; justify-content: space-between; align-items: center; }  .attention h3 { margin: 0 0 0.3em; font-size: 0.9em; color: var(--text-muted); }
	.att-item { display: flex; justify-content: space-between; gap: 0.5em; padding: 0.4em 0.6em; background: var(--code-bg); border-radius: 4px; margin-bottom: 0.3em; font-size: 0.88em; }  .att-item :global(strong) { color: var(--link); }
	.x, .clear-all { background: none; border: none; color: var(--text-muted); cursor: pointer; }  .x:hover, .clear-all:hover { color: var(--text); }  .clear-all { font-size: 0.75em; border: 1px solid var(--border); padding: 0.2em 0.4em; border-radius: 4px; }
	.waiting { text-align: center; padding: 3em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1em; }  .waiting-icon { font-size: 2em; margin-bottom: 0.5em; }
	.waiting-text { font-size: 1.1em; font-weight: 600; color: var(--text); margin-bottom: 0.3em; }  .waiting-hint { font-size: 0.85em; color: var(--text-muted); }  .screen-toggle { margin-bottom: 1em; }
	.toggle-btn { display: flex; align-items: center; gap: 0.4em; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 0.3em 0.7em; font-size: 0.82em; font-weight: 600; color: var(--text-muted); cursor: pointer; }  .toggle-btn:hover { color: var(--text); border-color: var(--text-muted); }  .toggle-arrow { font-size: 0.7em; }  .screen-wrap { margin-top: 0.5em; }
	.summary-section { margin-bottom: 1em; }
	.summary-hdr { display: flex; align-items: center; gap: 0.5em; }
	.summary-btn { padding: 0.4em 0.8em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.82em; font-weight: 600; color: var(--text-muted); }
	.summary-btn:hover:not(:disabled) { border-color: var(--link); color: var(--link); }  .summary-btn:disabled { opacity: 0.6; cursor: wait; }
	.summary-dismiss { background: none; border: none; font-size: 0.78em; color: var(--text-muted); cursor: pointer; padding: 0.2em 0.4em; }  .summary-dismiss:hover { color: var(--text); }
	.summary-text { margin-top: 0.5em; padding: 0.6em 0.8em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.85em; line-height: 1.5; color: var(--text); }
@media (max-width: 768px) {
		.goal { flex-direction: column; gap: 0.25em; }
	}
</style>

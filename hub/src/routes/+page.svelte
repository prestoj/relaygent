<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import ContextBar from '$lib/components/ContextBar.svelte';
	import SessionTimer from '$lib/components/SessionTimer.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import TodoWidget from '$lib/components/TodoWidget.svelte';
	import WelcomeCard from '$lib/components/WelcomeCard.svelte';
	import AttentionBanner from '$lib/components/AttentionBanner.svelte';
	import ScreenPreview from '$lib/components/ScreenPreview.svelte';
	import LiveStats from '$lib/components/LiveStats.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	let { data } = $props();
	let screenOpen = $state(false);
	let connected = $state(false);
	let contextPct = $state(data.contextPct);
	let attentionItems = data.attentionItems || [];
	let sessionStatus = $state(data.relayActivity?.length > 0 ? 'found' : 'waiting');
	let ws = null, svcInterval;
	let hookCtx = $state('');
	let services = $state(data.services || []);
	let relayRunning = $state(data.relayRunning ?? true);
	let handoffGoal = $derived(services?.find(s => s.name === 'Relay')?.goal || '');

	async function toggleRelay() {
		const action = relayRunning ? 'stop' : 'start';
		try { const r = await fetch('/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); if (r.ok) relayRunning = !relayRunning; } catch {}
	}

	async function refreshServices() { try { const d = await (await fetch('/api/services')).json(); services = d.services || []; } catch {} }

	function connect() {
		if (!browser) return;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		ws.onopen = () => { connected = true; };
		ws.onclose = () => { connected = false; setTimeout(connect, 3000); };
		ws.onmessage = (event) => {
			let msg; try { msg = JSON.parse(event.data); } catch { return; }
			if (msg.type === 'context') { contextPct = msg.pct; }
			else if (msg.type === 'hook') { hookCtx = msg.data?.context || ''; }
			else if (msg.type === 'session') { sessionStatus = msg.status; }
			else if (msg.type === 'activity') { sessionStatus = 'found'; }
		};
	}

	onMount(() => { connect(); if (browser) svcInterval = setInterval(refreshServices, 30000); });
	onDestroy(() => { if (ws) ws.close(); clearInterval(svcInterval); });
</script>

<svelte:head><title>Relaygent</title></svelte:head>

<StatusBar {connected} {relayRunning} {services} onToggleRelay={toggleRelay} />

{#if handoffGoal && !connected}
<section class="handoff-goal">
	<div class="hg-label">Next goal</div>
	<div class="hg-text">{handoffGoal}</div>
</section>
{/if}

{#if hookCtx}
<div class="hook-ctx"><span class="hook-label">Agent context</span>{hookCtx}</div>
{/if}

<ContextBar pct={contextPct} />
<SessionTimer sessionId={services?.find(s => s.name === 'Relay')?.sessionId} />
<LiveStats />

{#if sessionStatus === 'waiting' && !connected}
<section class="waiting">
	{#if relayRunning}
		<div class="waiting-icon">&#9203;</div>
		<div class="waiting-text">Agent is starting up...</div>
		<div class="waiting-hint">The dashboard will update automatically when the agent begins working.</div>
	{:else}
		<WelcomeCard hasIntent={data.hasIntent} isDocker={data.isDocker} onStart={toggleRelay} />
	{/if}
</section>
{:else}
<ChatPanel />
{/if}

<TodoWidget activities={[]} />
<AttentionBanner initialItems={attentionItems} />

<section class="screen-toggle">
	<button class="toggle-btn" onclick={() => screenOpen = !screenOpen}>
		<span class="toggle-arrow">{screenOpen ? '\u25BC' : '\u25B6'}</span> Screen
	</button>
	{#if screenOpen}<div class="screen-wrap"><ScreenPreview fps={2} /></div>{/if}
</section>

<style>
	.hook-ctx { font-size: 0.72em; color: var(--text-muted); padding: 0.3em 1em; background: var(--code-bg); border-radius: 6px; margin-bottom: 0.75em; font-family: monospace; white-space: pre-wrap; word-break: break-word; }
	.hook-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-right: 0.6em; font-size: 0.9em; }
	.handoff-goal { display: flex; align-items: baseline; gap: 0.75em; padding: 0.5em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1em; }
	.hg-label { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); white-space: nowrap; }
	.hg-text { color: var(--text); font-size: 0.88em; line-height: 1.4; }
	.waiting { text-align: center; padding: 3em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1em; }
	.waiting-icon { font-size: 2em; margin-bottom: 0.5em; }
	.waiting-text { font-size: 1.1em; font-weight: 600; color: var(--text); margin-bottom: 0.3em; }
	.waiting-hint { font-size: 0.85em; color: var(--text-muted); }
	.screen-toggle { margin-bottom: 1em; }
	.toggle-btn { display: flex; align-items: center; gap: 0.4em; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 0.3em 0.7em; font-size: 0.82em; font-weight: 600; color: var(--text-muted); cursor: pointer; }
	.toggle-btn:hover { color: var(--text); border-color: var(--text-muted); }
	.toggle-arrow { font-size: 0.7em; }
	.screen-wrap { margin-top: 0.5em; }
	@media (max-width: 768px) { .handoff-goal { flex-direction: column; gap: 0.25em; } }
</style>

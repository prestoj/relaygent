<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import ContextBar from '$lib/components/ContextBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import WelcomeCard from '$lib/components/WelcomeCard.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	let { data } = $props();
	let connected = $state(false);
	let contextPct = $state(data.contextPct);
	let sessionStatus = $state(data.relayActivity?.length > 0 ? 'found' : 'waiting');
	let ws = null, svcInterval;
	let services = $state(data.services || []);
	let relayRunning = $state(data.relayRunning ?? true);

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
			else if (msg.type === 'session') { sessionStatus = msg.status; }
			else if (msg.type === 'activity') { sessionStatus = 'found'; }
		};
	}

	onMount(() => { connect(); if (browser) svcInterval = setInterval(refreshServices, 30000); });
	onDestroy(() => { if (ws) ws.close(); clearInterval(svcInterval); });
</script>

<svelte:head><title>Relaygent</title></svelte:head>

<StatusBar {connected} {relayRunning} {services} onToggleRelay={toggleRelay} />
<ContextBar pct={contextPct} />

{#if sessionStatus === 'waiting' && !connected}
<section class="waiting">
	{#if relayRunning}
		<div class="waiting-text">Agent is starting up...</div>
		<div class="waiting-hint">The dashboard will update automatically when the agent begins working.</div>
	{:else}
		<WelcomeCard hasIntent={data.hasIntent} isDocker={data.isDocker} onStart={toggleRelay} />
	{/if}
</section>
{:else}
<ChatPanel />
{/if}

<style>
	.waiting { text-align: center; padding: 3em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-top: 1em; }
	.waiting-text { font-size: 1.1em; font-weight: 600; color: var(--text); margin-bottom: 0.3em; }
	.waiting-hint { font-size: 0.85em; color: var(--text-muted); }
</style>

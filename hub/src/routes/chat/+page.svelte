<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import WelcomeCard from '$lib/components/WelcomeCard.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	let { data } = $props();
	let sessionStatus = $state(data.relayActivity?.length > 0 ? 'found' : 'waiting');
	let ws = null;
	let relayRunning = $state(data.relayRunning ?? true);

	async function toggleRelay() {
		const action = relayRunning ? 'stop' : 'start';
		try { const r = await fetch('/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); if (r.ok) relayRunning = !relayRunning; } catch {}
	}

	function connect() {
		if (!browser) return;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		ws.onclose = () => { setTimeout(connect, 3000); };
		ws.onmessage = (event) => {
			let msg; try { msg = JSON.parse(event.data); } catch { return; }
			if (msg.type === 'session') { sessionStatus = msg.status; }
			else if (msg.type === 'activity') { sessionStatus = 'found'; }
		};
	}

	onMount(() => { connect(); });
	onDestroy(() => { if (ws) ws.close(); });
</script>

<svelte:head><title>Relaygent · Chat</title></svelte:head>

{#if sessionStatus === 'waiting' && !relayRunning}
	<WelcomeCard hasIntent={data.hasIntent} isDocker={data.isDocker} onStart={toggleRelay} />
{:else}
	<ChatPanel fullPage />
{/if}

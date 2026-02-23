<script>
	import { onMount, onDestroy } from 'svelte';

	let { onfail = null } = $props();
	let container = $state(null);
	let rfb = null;
	let status = $state('Connecting...');
	let connected = $state(false);
	let passwordNeeded = $state(false);
	let password = $state('');
	let configPw = null;
	let RFB = null;
	let reconnectTimer = null;
	let destroyed = false;

	async function connect() {
		if (destroyed) return;
		status = 'Connecting...';
		passwordNeeded = false;
		try {
			if (!RFB) {
				const [mod, cfg] = await Promise.all([
					new Function('return import("/novnc/rfb.js")')(),
					fetch('/api/vnc').then(r => r.json()).catch(() => ({}))
				]);
				RFB = mod.default;
				configPw = cfg.password || new URLSearchParams(location.search).get('pw');
			}
			// Clear previous canvas elements from container
			if (container) while (container.firstChild) container.removeChild(container.firstChild);
			const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			rfb = new RFB(container, `${proto}//${location.host}/ws/vnc`);
			rfb.scaleViewport = true;
			rfb.resizeSession = false;
			rfb.addEventListener('connect', () => { status = 'Connected'; connected = true; });
			rfb.addEventListener('disconnect', (e) => {
				connected = false;
				rfb = null;
				if (destroyed) return;
				status = e.detail.clean ? 'Disconnected' : 'Connection lost — reconnecting...';
				if (!e.detail.clean && onfail) onfail();
				reconnectTimer = setTimeout(connect, 5000);
			});
			rfb.addEventListener('credentialsrequired', () => {
				if (configPw) { rfb.sendCredentials({ password: configPw }); status = 'Authenticating...'; return; }
				passwordNeeded = true;
				status = 'VNC password required';
			});
		} catch (e) {
			status = `Error: ${e.message}`;
			reconnectTimer = setTimeout(connect, 5000);
		}
	}

	function reconnect() { clearTimeout(reconnectTimer); connect(); }

	function submitPassword() {
		const pw = password || document.querySelector('.pw-prompt input')?.value;
		if (rfb && pw) { rfb.sendCredentials({ password: pw }); passwordNeeded = false; status = 'Authenticating...'; }
	}

	onMount(connect);
	onDestroy(() => { destroyed = true; clearTimeout(reconnectTimer); if (rfb) { try { rfb.disconnect(); } catch {} } });
</script>

<div class="vnc-page">
	<div class="vnc-header">
		<span class="dot" class:ok={connected}></span>
		<span class="label">Screen (VNC)</span>
		<span class="vnc-status">{status}</span>
		{#if !connected}<button class="reconnect" onclick={reconnect}>Reconnect</button>{/if}
	</div>
	{#if passwordNeeded}
		<div class="pw-prompt">
			<input type="password" bind:value={password} placeholder="VNC Password"
				onkeydown={(e) => { if (e.key === 'Enter') submitPassword(); }} />
			<button onclick={submitPassword}>Connect</button>
		</div>
	{/if}
	<div class="vnc-container" bind:this={container}></div>
</div>

<style>
	.vnc-page { height: 100vh; display: flex; flex-direction: column; background: #000; }
	.vnc-header { display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.6em; background: #111; border-bottom: 1px solid #333; }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--error, #ef4444); flex-shrink: 0; }
	.dot.ok { background: var(--success, #22c55e); }
	.label { font-weight: 600; font-size: 0.8em; color: #fff; }
	.vnc-status { font-size: 0.72em; color: #888; font-family: monospace; }
	.reconnect { font-size: 0.72em; padding: 0.15em 0.5em; border-radius: 3px; border: 1px solid #555; background: #333; color: #ccc; cursor: pointer; margin-left: auto; }
	.reconnect:hover { background: #444; color: #fff; }
	.vnc-container { flex: 1; overflow: hidden; }
	.pw-prompt { display: flex; gap: 0.5em; padding: 1em; background: #222; justify-content: center; }
	.pw-prompt input { padding: 0.3em 0.6em; border-radius: 4px; border: 1px solid #555; background: #333; color: #fff; }
	.pw-prompt button { padding: 0.3em 0.8em; border-radius: 4px; border: 1px solid #555; background: #444; color: #fff; cursor: pointer; }
</style>

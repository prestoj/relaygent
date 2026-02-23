<script>
	import { onMount, onDestroy } from 'svelte';

	let container = $state(null);
	let rfb = null;
	let status = $state('Connecting...');
	let connected = $state(false);
	let passwordNeeded = $state(false);
	let password = $state('');

	onMount(async () => {
		try {
			const mod = await new Function('return import("/novnc/rfb.js")')();
			const RFB = mod.default;
			const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			const url = `${proto}//${location.host}/ws/vnc`;
			rfb = new RFB(container, url);
			rfb.scaleViewport = true;
			rfb.resizeSession = false;
			rfb.addEventListener('connect', () => { status = 'Connected'; connected = true; });
			rfb.addEventListener('disconnect', (e) => {
				connected = false;
				status = e.detail.clean ? 'Disconnected' : 'Connection lost — is VNC running on this machine?';
				rfb = null;
			});
			rfb.addEventListener('credentialsrequired', () => {
				passwordNeeded = true;
				status = 'VNC password required';
			});
		} catch (e) {
			status = `Error: ${e.message}`;
		}
	});

	function submitPassword() {
		if (rfb && password) {
			rfb.sendCredentials({ password });
			passwordNeeded = false;
			status = 'Authenticating...';
		}
	}

	onDestroy(() => { if (rfb) { try { rfb.disconnect(); } catch {} } });
</script>

<div class="vnc-page">
	<div class="vnc-header">
		<span class="dot" class:ok={connected}></span>
		<span class="label">Screen (VNC)</span>
		<span class="vnc-status">{status}</span>
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
	.vnc-container { flex: 1; overflow: hidden; }
	.pw-prompt { display: flex; gap: 0.5em; padding: 1em; background: #222; justify-content: center; }
	.pw-prompt input { padding: 0.3em 0.6em; border-radius: 4px; border: 1px solid #555; background: #333; color: #fff; }
	.pw-prompt button { padding: 0.3em 0.8em; border-radius: 4px; border: 1px solid #555; background: #444; color: #fff; cursor: pointer; }
</style>

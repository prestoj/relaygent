<script>
	import { onMount, onDestroy } from 'svelte';
	let relayRunning = $state(null), relayToggling = $state(false);
	let wrapState = $state('idle'); // idle | sending | queued
	let pollTimer;

	async function fetchRelayStatus() {
		try { const r = await fetch('/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) }); if (r.ok) { const d = await r.json(); relayRunning = d.running; } } catch {}
	}

	async function toggleRelay() {
		relayToggling = true;
		const action = relayRunning ? 'stop' : 'start';
		try { const r = await fetch('/api/relay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); if (r.ok) relayRunning = !relayRunning; } catch {}
		relayToggling = false;
	}

	async function requestWrap() {
		if (wrapState !== 'idle') return;
		if (!confirm('Wrap up session?\n\nThe agent will be notified to write its handoff and spawn a successor.')) return;
		wrapState = 'sending';
		try {
			const r = await fetch('/api/relay/retire', { method: 'POST' });
			if (!r.ok) { alert('Wrap request failed: HTTP ' + r.status); wrapState = 'idle'; return; }
			wrapState = 'queued';
			setTimeout(() => { wrapState = 'idle'; }, 60000);
		} catch (e) { alert('Wrap request error: ' + e); wrapState = 'idle'; }
	}

	onMount(() => { fetchRelayStatus(); pollTimer = setInterval(fetchRelayStatus, 15000); });
	onDestroy(() => clearInterval(pollTimer));
</script>

<section class="card">
	<h2>Relay</h2>
	<div class="relay-row">
		<span class="dot" class:up={relayRunning} class:down={relayRunning === false}></span>
		<span class="svc-name">{relayRunning === null ? 'Checking...' : relayRunning ? 'Running' : 'Stopped'}</span>
		<div class="btns">
			{#if relayRunning !== null}
				<button class="relay-btn" onclick={toggleRelay} disabled={relayToggling}>{relayToggling ? '...' : relayRunning ? 'Stop' : 'Start'}</button>
			{/if}
			<button class="wrap-btn" class:queued={wrapState === 'queued'} onclick={requestWrap} disabled={wrapState !== 'idle'}
				title="Notify agent to write its handoff + spawn a fresh successor">
				{wrapState === 'sending' ? '…' : wrapState === 'queued' ? 'Wrap queued ✓' : 'Wrap up session'}
			</button>
		</div>
	</div>
	<p class="hint">"Wrap up session" notifies the agent to write its handoff and spawn a fresh successor.</p>
</section>

<style>
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1em; }
	.relay-row { display: flex; align-items: center; gap: 0.6em; font-size: 0.9em; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.dot.up { background: var(--success); }  .dot.down { background: var(--error); }
	.svc-name { font-weight: 600; }
	.btns { display: flex; gap: 0.5em; margin-left: auto; }
	.relay-btn { padding: 0.25em 0.6em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.8em; cursor: pointer; }
	.relay-btn:hover:not(:disabled) { background: var(--code-bg); }  .relay-btn:disabled { opacity: 0.5; }
	.wrap-btn { padding: 0.25em 0.6em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-muted); font-size: 0.8em; cursor: pointer; font-weight: 600; }
	.wrap-btn:hover:not(:disabled) { color: var(--warning, #f59e0b); border-color: var(--warning, #f59e0b); }
	.wrap-btn:disabled { opacity: 0.7; cursor: not-allowed; }
	.wrap-btn.queued { color: var(--success, #22c55e); border-color: var(--success, #22c55e); opacity: 1; }
	.hint { font-size: 0.78em; color: var(--text-muted); margin: 0.75em 0 0; }
</style>

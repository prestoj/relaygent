<script>
	let { connected = false, relayRunning = true, services = [], onToggleRelay } = $props();
	let actionPending = $state(false);
	async function toggle() {
		if (actionPending) return;
		actionPending = true;
		await onToggleRelay?.();
		actionPending = false;
	}
</script>

<section class="status-bar">
	<div class="status-item">
		<span class="indicator" class:pulse={connected}></span>
		<span class="relay-label">Relay</span>
		<span class="badge" class:on={connected}>{connected ? 'Live' : 'Offline'}</span>
	</div>
	<button class="relay-toggle" class:stopping={relayRunning} class:starting={!relayRunning} onclick={toggle} disabled={actionPending} title={relayRunning ? 'Stop relay' : 'Start relay'}>{actionPending ? '…' : relayRunning ? 'Stop' : 'Start'}</button>
	{#if services?.length}
	<div class="svc-row">
		{#each services as svc}
			<span class="svc" class:up={svc.ok} class:down={!svc.ok} title={svc.detail || ''}>
				<span class="dot"></span>{svc.name}{#if svc.name === 'Relay' && svc.detail && svc.detail !== 'working'}<span class="relay-detail">{svc.detail}</span>{/if}
			</span>
		{/each}
	</div>
	{/if}
</section>

<style>
	.status-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75em; padding: 0.6em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1em; }
	.status-item { display: flex; align-items: center; gap: 0.5em; }  .relay-label { font-weight: 600; color: var(--text); }
	.indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
	.indicator.pulse { background: #22c55e; animation: pulse 2s infinite; }
	@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
	.badge { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 10px; background: #fee2e2; color: #dc2626; }  .badge.on { background: #dcfce7; color: #16a34a; }
	.relay-toggle { font-size: 0.78em; padding: 0.2em 0.6em; border-radius: 4px; border: 1px solid var(--border); cursor: pointer; font-weight: 600; background: var(--bg-surface); color: var(--text-muted); }
	.relay-toggle:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text); }  .relay-toggle:disabled { opacity: 0.5; cursor: wait; }
	.relay-toggle.stopping { border-color: #fca5a5; color: #dc2626; background: #fef2f2; }  .relay-toggle.stopping:hover:not(:disabled) { background: #fee2e2; }
	.relay-toggle.starting { border-color: #86efac; color: #16a34a; background: #f0fdf4; }  .relay-toggle.starting:hover:not(:disabled) { background: #dcfce7; }
	.svc-row { display: flex; flex-wrap: wrap; gap: 0.4em 0.8em; margin-left: auto; }  .svc { display: flex; align-items: center; gap: 0.3em; font-size: 0.78em; color: var(--text-muted); }  .svc .dot { width: 5px; height: 5px; border-radius: 50%; }
	.svc.up .dot { background: #22c55e; } .svc.down .dot { background: #ef4444; } .svc.down { color: #ef4444; } .relay-detail { opacity: 0.7; font-size: 0.9em; margin-left: 0.1em; }
</style>

<script>
	import { onMount, onDestroy } from 'svelte';
	let { data } = $props();
	let services = $state(data.services);
	let showAllHealth = $state(false);
	let restarting = $state(false);
	let restartMsg = $state('');
	const chUrgent = (data.codeHealth?.files || []).filter(f => f.lines >= 170);
	const chRest = (data.codeHealth?.files || []).filter(f => f.lines < 170);
	let anyDown = $derived(services.some(s => !s.ok));
	let pollTimer;

	async function restartAll() {
		restarting = true; restartMsg = '';
		try {
			const r = await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) });
			const d = await r.json();
			restartMsg = r.ok ? 'Restart complete' : (d.output || 'Restart failed');
			setTimeout(async () => { try { services = (await (await fetch('/api/services')).json()).services; } catch { /* wait for recovery */ } }, 3000);
		} catch { restartMsg = 'Network error — hub may be restarting'; }
		restarting = false;
	}

	onMount(() => {
		pollTimer = setInterval(async () => {
			try {
				const res = await fetch('/api/services');
				if (res.ok) services = (await res.json()).services;
			} catch { /* ignore */ }
		}, 15000);
	});
	onDestroy(() => clearInterval(pollTimer));
</script>

<svelte:head><title>Settings — Relaygent</title></svelte:head>

<h1>Settings</h1>

{#if data.setupChecks?.some(c => !c.ok)}
<section class="card">
	<h2>Setup</h2>
	<div class="check-list">
		{#each data.setupChecks as check}
			<div class="check-row">
				<span class="dot" class:up={check.ok} class:down={!check.ok}></span>
				<span class="check-label">{check.label}</span>
				{#if !check.ok}<span class="check-hint">{check.hint}</span>{/if}
			</div>
		{/each}
	</div>
	<p class="hint">Complete all checks for the best experience</p>
</section>
{/if}

<section class="card">
	<h2>System</h2>
	<div class="grid">
		<div class="label">Hostname</div><div class="value">{data.system.hostname}</div>
		<div class="label">Platform</div><div class="value">{data.system.platform}</div>
		<div class="label">Kernel</div><div class="value">{data.system.release}</div>
		<div class="label">Node</div><div class="value">{data.system.nodeVersion}</div>
		<div class="label">Uptime</div><div class="value">{data.system.uptime}</div>
		<div class="label">CPUs</div><div class="value">{data.system.cpus}</div>
		<div class="label">Memory</div><div class="value">{data.system.memUsed} / {data.system.memTotal}</div>
		{#if data.version}<div class="label">Version</div><div class="value mono">{data.version}</div>{/if}
	</div>
</section>

<section class="card">
	<h2>Services</h2>
	<div class="svc-list">
		{#each services as svc}
			<div class="svc-row">
				<span class="dot" class:up={svc.ok} class:down={!svc.ok}></span>
				<span class="svc-name">{svc.name}</span>
				{#if svc.detail}<span class="svc-detail">{svc.detail}</span>{/if}
			</div>
		{/each}
	</div>
	<div class="svc-footer">
		<p class="hint">Auto-refreshes every 15 seconds</p>
		{#if anyDown}
			<button class="restart-btn" onclick={restartAll} disabled={restarting}>{restarting ? 'Restarting...' : 'Restart All Services'}</button>
		{/if}
		{#if restartMsg}<span class="restart-msg">{restartMsg}</span>{/if}
	</div>
</section>

<section class="card">
	<h2>MCP Servers</h2>
	{#if data.mcpServers.length === 0}
		<p class="empty">No MCP servers configured.</p>
	{:else}
		<div class="mcp-list">
			{#each data.mcpServers as srv}
				<div class="mcp-row">
					<span class="mcp-name">{srv.name}</span>
					<span class="mcp-cmd">{srv.command} {srv.args}</span>
				</div>
			{/each}
		</div>
	{/if}
	<p class="hint">Manage with <code>relaygent mcp add|remove</code></p>
</section>

{#if data.codeHealth?.files.length > 0}
<section class="card">
	<h2>Code Health</h2>
	<p class="ch-summary">{chUrgent.length} file{chUrgent.length !== 1 ? 's' : ''} need attention · {data.codeHealth.files.length} total over {data.codeHealth.threshold}</p>
	<div class="ch-list">
		{#each chUrgent as f}
			<div class="ch-row">
				<span class="ch-bar" style="width: {Math.min(f.pct, 100)}%; background: {f.lines >= 180 ? 'var(--error)' : 'var(--warning)'}"></span>
				<span class="ch-file">{f.path}</span>
				<span class="ch-count" class:danger={f.lines >= 180} class:warn={f.lines >= 170 && f.lines < 180}>{f.lines}</span>
			</div>
		{/each}
		{#if chRest.length > 0}
			{#if showAllHealth}
				{#each chRest as f}
					<div class="ch-row">
						<span class="ch-bar" style="width: {Math.min(f.pct, 100)}%; background: var(--success)"></span>
						<span class="ch-file">{f.path}</span>
						<span class="ch-count">{f.lines}</span>
					</div>
				{/each}
			{/if}
			<button class="ch-toggle" onclick={() => showAllHealth = !showAllHealth}>{showAllHealth ? 'Show less' : `Show ${chRest.length} more`}</button>
		{/if}
	</div>
</section>
{/if}

<section class="card">
	<h2>Configuration</h2>
	<div class="grid">
		<div class="label">Hub port</div><div class="value">{data.config.hubPort}</div>
		<div class="label">Notifications port</div><div class="value">{data.config.notificationsPort}</div>
		<div class="label">Auth</div><div class="value">{data.config.authEnabled ? 'Enabled' : 'Disabled'}</div>
		{#if data.config.repoPath}
			<div class="label">Repo</div><div class="value mono">{data.config.repoPath}</div>
		{/if}
	</div>
	<p class="hint">Edit <code>~/.relaygent/config.json</code> to change</p>
</section>

<style>
	h1 { margin-top: 0; }
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1em; }
	.grid { display: grid; grid-template-columns: 10em 1fr; gap: 0.35em 1em; font-size: 0.9em; }
	.label { color: var(--text-muted); }  .value { color: var(--text); }  .mono { font-family: monospace; font-size: 0.9em; }
	.hint { font-size: 0.78em; color: var(--text-muted); margin: 0.75em 0 0; }
	.svc-list { display: flex; flex-direction: column; gap: 0.5em; }
	.svc-row { display: flex; align-items: center; gap: 0.6em; font-size: 0.9em; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.dot.up { background: var(--success); }  .dot.down { background: var(--error); }
	.svc-name { font-weight: 600; }  .svc-detail { color: var(--text-muted); font-size: 0.88em; }
	.svc-footer { display: flex; align-items: center; gap: 0.75em; margin-top: 0.75em; flex-wrap: wrap; }
	.restart-btn { padding: 0.3em 0.7em; border: 1px solid var(--error); border-radius: 6px; background: var(--bg); color: var(--error); font-size: 0.78em; cursor: pointer; font-weight: 600; }
	.restart-btn:hover:not(:disabled) { background: var(--error); color: #fff; }  .restart-btn:disabled { opacity: 0.5; cursor: default; }
	.restart-msg { font-size: 0.78em; color: var(--text-muted); }
	.mcp-list { display: flex; flex-direction: column; gap: 0.4em; }
	.mcp-row { display: flex; align-items: baseline; gap: 0.75em; font-size: 0.9em; padding: 0.3em 0.5em; background: var(--bg); border-radius: 4px; border: 1px solid var(--border); }
	.mcp-name { font-weight: 600; font-family: monospace; white-space: nowrap; }
	.mcp-cmd { color: var(--text-muted); font-family: monospace; font-size: 0.85em; word-break: break-word; }
	.empty { color: var(--text-muted); font-size: 0.88em; margin: 0; }
	.check-list { display: flex; flex-direction: column; gap: 0.5em; }
	.check-row { display: flex; align-items: center; gap: 0.6em; font-size: 0.9em; }
	.check-label { font-weight: 600; min-width: 5em; }
	.check-hint { color: var(--text-muted); font-size: 0.85em; font-family: monospace; }
	.ch-summary { font-size: 0.82em; color: var(--text-muted); margin: 0 0 0.75em; }
	.ch-list { display: flex; flex-direction: column; gap: 0.3em; }
	.ch-row { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 0.3em 0.5em; background: var(--bg); border-radius: 4px; border: 1px solid var(--border); overflow: hidden; font-size: 0.85em; }
	.ch-bar { position: absolute; left: 0; top: 0; bottom: 0; opacity: 0.12; border-radius: 4px; }
	.ch-file { font-family: monospace; z-index: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ch-count { font-family: monospace; font-weight: 600; z-index: 1; flex-shrink: 0; margin-left: 0.5em; }
	.ch-count.danger { color: var(--error); }  .ch-count.warn { color: var(--warning); }
	.ch-toggle { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0.3em 0.6em; font-size: 0.78em; color: var(--text-muted); cursor: pointer; margin-top: 0.3em; }
	.ch-toggle:hover { color: var(--link); border-color: var(--link); }
	@media (max-width: 600px) {
		.grid { grid-template-columns: 7em 1fr; gap: 0.25em 0.5em; font-size: 0.85em; }
	}
</style>

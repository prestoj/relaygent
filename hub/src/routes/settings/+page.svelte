<script>
	import { onMount, onDestroy } from 'svelte';
	let { data } = $props();
	let services = $state(data.services);
	let pollTimer;

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
	<p class="hint">Auto-refreshes every 15 seconds</p>
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
	.label { color: var(--text-muted); }
	.value { color: var(--text); }
	.mono { font-family: monospace; font-size: 0.9em; }
	.hint { font-size: 0.78em; color: var(--text-muted); margin: 0.75em 0 0; }
	.svc-list { display: flex; flex-direction: column; gap: 0.5em; }
	.svc-row { display: flex; align-items: center; gap: 0.6em; font-size: 0.9em; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.dot.up { background: var(--success); }
	.dot.down { background: var(--error); }
	.svc-name { font-weight: 600; }
	.svc-detail { color: var(--text-muted); font-size: 0.88em; }
	.mcp-list { display: flex; flex-direction: column; gap: 0.4em; }
	.mcp-row { display: flex; align-items: baseline; gap: 0.75em; font-size: 0.9em; padding: 0.3em 0.5em; background: var(--bg); border-radius: 4px; border: 1px solid var(--border); }
	.mcp-name { font-weight: 600; font-family: monospace; white-space: nowrap; }
	.mcp-cmd { color: var(--text-muted); font-family: monospace; font-size: 0.85em; word-break: break-word; }
	.empty { color: var(--text-muted); font-size: 0.88em; margin: 0; }
	.check-list { display: flex; flex-direction: column; gap: 0.5em; }
	.check-row { display: flex; align-items: center; gap: 0.6em; font-size: 0.9em; }
	.check-label { font-weight: 600; min-width: 5em; }
	.check-hint { color: var(--text-muted); font-size: 0.85em; font-family: monospace; }
	@media (max-width: 600px) {
		.grid { grid-template-columns: 7em 1fr; gap: 0.25em 0.5em; font-size: 0.85em; }
	}
</style>

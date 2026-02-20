<script>
	import { onMount, onDestroy, tick } from 'svelte';

	const FILES = [
		{ id: 'relaygent', label: 'Relay' },
		{ id: 'relaygent-hub', label: 'Hub' },
		{ id: 'relaygent-notifications', label: 'Notifications' },
		{ id: 'slack-socket', label: 'Slack Socket' },
	];

	let selectedFile = $state('relaygent');
	let lines = $state('');
	let loading = $state(false);
	let error = $state('');
	let autoScroll = $state(true);
	let lineCount = $state(200);
	let preEl = $state(null);
	let pollInterval;

	async function fetchLogs() {
		loading = true; error = '';
		try {
			const res = await fetch(`/api/logs?file=${selectedFile}&lines=${lineCount}`);
			const d = await res.json();
			if (d.error) { error = d.error; lines = ''; }
			else { lines = d.lines || ''; }
			if (autoScroll) await tick().then(scrollBottom);
		} catch (e) { error = 'Network error'; }
		loading = false;
	}

	function scrollBottom() {
		if (preEl) preEl.scrollTop = preEl.scrollHeight;
	}

	function onFileChange() { fetchLogs(); }

	onMount(() => {
		fetchLogs();
		pollInterval = setInterval(fetchLogs, 10000);
	});
	onDestroy(() => clearInterval(pollInterval));
</script>

<svelte:head><title>Logs — Relaygent</title></svelte:head>

<div class="header">
	<h1>Logs</h1>
	<div class="controls">
		<select bind:value={selectedFile} onchange={onFileChange}>
			{#each FILES as f}
				<option value={f.id}>{f.label}</option>
			{/each}
		</select>
		<select bind:value={lineCount} onchange={fetchLogs}>
			<option value={100}>100 lines</option>
			<option value={200}>200 lines</option>
			<option value={500}>500 lines</option>
			<option value={1000}>1000 lines</option>
		</select>
		<label class="auto-scroll">
			<input type="checkbox" bind:checked={autoScroll} />
			Auto-scroll
		</label>
		<button onclick={fetchLogs} disabled={loading}>Refresh</button>
	</div>
</div>

{#if error}
	<p class="error">{error}</p>
{/if}

<div class="log-wrap">
	<pre bind:this={preEl} class="log-content">{lines || (loading ? 'Loading…' : '(empty)')}</pre>
</div>

<style>
	.header {
		display: flex; align-items: center; justify-content: space-between;
		gap: 1em; flex-wrap: wrap; margin-bottom: 0.75em;
	}
	h1 { margin: 0; }
	.controls { display: flex; gap: 0.5em; align-items: center; flex-wrap: wrap; }
	select {
		padding: 0.35em 0.6em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg-surface); color: var(--text); font-size: 0.88em; cursor: pointer;
	}
	button {
		padding: 0.35em 0.85em; background: var(--link); color: white;
		border: none; border-radius: 6px; cursor: pointer; font-size: 0.88em;
	}
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	.auto-scroll { display: flex; align-items: center; gap: 0.3em; font-size: 0.88em; cursor: pointer; color: var(--text-muted); }
	.log-wrap {
		background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
		overflow: hidden;
	}
	.log-content {
		margin: 0; padding: 1em; font-size: 0.78em; line-height: 1.5;
		max-height: 75vh; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
		color: var(--text);
	}
	.error { color: #ef4444; font-size: 0.88em; }
</style>

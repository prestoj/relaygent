<script>
	import { onMount, onDestroy, tick } from 'svelte';

	const FILES = [
		{ id: 'relaygent', label: 'Relay' },
		{ id: 'relaygent-hub', label: 'Hub' },
		{ id: 'relaygent-notifications', label: 'Notifications' },
		{ id: 'slack-socket', label: 'Slack Socket' },
	];

	let selectedFile = $state('relaygent');
	let rawLines = $state('');
	let loading = $state(false);
	let error = $state('');
	let autoScroll = $state(true);
	let lineCount = $state(200);
	let search = $state('');
	let preEl = $state(null);
	let pollInterval;

	const RE_TS = /^(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}[:\d.]*\S*|\[\d{4}-\d{2}-\d{2}[^\]]*\])/;
	const RE_ERR = /\b(error|exception|traceback|fatal|panic|fail(ed)?)\b/i;
	const RE_WARN = /\b(warn(ing)?|deprecated)\b/i;

	function classify(line) {
		if (RE_ERR.test(line)) return 'err';
		if (RE_WARN.test(line)) return 'warn';
		return '';
	}

	let lines = $derived(rawLines ? rawLines.split('\n') : []);
	let filtered = $derived(() => {
		if (!search) return lines;
		const q = search.toLowerCase();
		return lines.filter(l => l.toLowerCase().includes(q));
	});

	function highlightLine(line) {
		let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		// Highlight search term
		if (search) {
			const esc = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			s = s.replace(new RegExp(`(${esc})`, 'gi'), '<mark>$1</mark>');
		}
		// Dim timestamps
		const m = s.match(RE_TS);
		if (m) s = `<span class="ts">${m[0]}</span>${s.slice(m[0].length)}`;
		return s;
	}

	async function fetchLogs() {
		loading = true; error = '';
		try {
			const res = await fetch(`/api/logs?file=${selectedFile}&lines=${lineCount}`);
			const d = await res.json();
			if (d.error) { error = d.error; rawLines = ''; }
			else { rawLines = d.lines || ''; }
			if (autoScroll) await tick().then(scrollBottom);
		} catch { error = 'Network error'; }
		loading = false;
	}

	function scrollBottom() { if (preEl) preEl.scrollTop = preEl.scrollHeight; }
	function onFileChange() { fetchLogs(); }
	onMount(() => { fetchLogs(); pollInterval = setInterval(fetchLogs, 10000); });
	onDestroy(() => clearInterval(pollInterval));
</script>

<svelte:head><title>Logs — Relaygent</title></svelte:head>

<div class="header">
	<h1>Logs</h1>
	<div class="controls">
		<select bind:value={selectedFile} onchange={onFileChange}>
			{#each FILES as f}<option value={f.id}>{f.label}</option>{/each}
		</select>
		<select bind:value={lineCount} onchange={fetchLogs}>
			<option value={100}>100</option><option value={200}>200</option>
			<option value={500}>500</option><option value={1000}>1000</option>
		</select>
		<label class="auto-scroll"><input type="checkbox" bind:checked={autoScroll} />Auto-scroll</label>
		<button onclick={fetchLogs} disabled={loading}>Refresh</button>
	</div>
</div>

<div class="search-row">
	<input type="search" class="search" bind:value={search} placeholder="Filter logs..." />
	{#if search}<span class="match-count">{filtered().length} / {lines.length} lines</span>{/if}
</div>

{#if error}<p class="error">{error}</p>{/if}

<div class="log-wrap" bind:this={preEl}>
	{#if lines.length === 0}
		<div class="empty">{loading ? 'Loading...' : '(empty)'}</div>
	{:else}
		{#each filtered() as line, i}
			<div class="line {classify(line)}">{@html highlightLine(line)}</div>
		{/each}
	{/if}
</div>

<style>
	.header { display: flex; align-items: center; justify-content: space-between; gap: 1em; flex-wrap: wrap; margin-bottom: 0.5em; }
	h1 { margin: 0; }
	.controls { display: flex; gap: 0.5em; align-items: center; flex-wrap: wrap; }
	select { padding: 0.3em 0.5em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text); font-size: 0.85em; }
	button { padding: 0.3em 0.7em; background: var(--link); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85em; }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	.auto-scroll { display: flex; align-items: center; gap: 0.3em; font-size: 0.85em; cursor: pointer; color: var(--text-muted); }
	.search-row { display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em; }
	.search { flex: 1; padding: 0.35em 0.6em; border: 1px solid var(--border); border-radius: 6px; font-size: 0.85em; background: var(--bg-surface); color: var(--text); }
	.match-count { font-size: 0.78em; color: var(--text-muted); white-space: nowrap; }
	.error { color: var(--error); font-size: 0.85em; }
	.log-wrap { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; max-height: 72vh; overflow-y: auto; font-family: monospace; font-size: 0.78em; line-height: 1.5; }
	.empty { padding: 1em; color: var(--text-muted); }
	.line { padding: 0.1em 0.75em; border-left: 3px solid transparent; white-space: pre-wrap; word-break: break-all; }
	.line:hover { background: var(--code-bg); }
	.line.err { border-left-color: var(--error); color: var(--error); background: color-mix(in srgb, var(--error) 5%, var(--bg-surface)); }
	.line.warn { border-left-color: var(--warning); background: color-mix(in srgb, var(--warning) 4%, var(--bg-surface)); }
	.line :global(.ts) { color: var(--text-muted); }
	.line :global(mark) { background: color-mix(in srgb, var(--link) 25%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
</style>

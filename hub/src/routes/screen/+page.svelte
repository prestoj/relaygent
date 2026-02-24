<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import VncViewer from '$lib/components/VncViewer.svelte';
	let mode = $state('observe');
	let imgSrc = $state('');
	let error = $state(false);
	let timer;

	async function refreshScreenshot() {
		try {
			const r = await fetch(`/api/screen?t=${Date.now()}`);
			if (!r.ok) { error = true; return; }
			const blob = await r.blob();
			if (imgSrc) URL.revokeObjectURL(imgSrc);
			imgSrc = URL.createObjectURL(blob);
			error = false;
		} catch { error = true; }
	}

	function startPolling() { refreshScreenshot(); timer = setInterval(refreshScreenshot, 3000); }
	function stopPolling() { clearInterval(timer); }

	function activate() { stopPolling(); mode = 'interactive'; }
	function deactivate() { mode = 'observe'; startPolling(); }

	onMount(() => { if (browser) startPolling(); });
	onDestroy(() => { stopPolling(); if (imgSrc) URL.revokeObjectURL(imgSrc); });
</script>

<svelte:head><title>Screen — Relaygent</title></svelte:head>

{#if mode === 'observe'}
	<div class="observe">
		<div class="obs-header">
			<span class="obs-title">Screen — Observation Mode</span>
			<span class="obs-hint">Click image to take control</span>
		</div>
		{#if error}
			<div class="obs-error">Screenshot unavailable — computer-use may not be running</div>
		{:else if imgSrc}
			<button class="obs-img-btn" onclick={activate} title="Click to take control">
				<img src={imgSrc} alt="Screen" class="obs-img" />
			</button>
		{:else}
			<div class="obs-loading">Loading screenshot...</div>
		{/if}
	</div>
{:else}
	<div class="interactive">
		<div class="int-header">
			<span class="int-title">Screen — Interactive</span>
			<button class="int-back" onclick={deactivate}>Back to observation</button>
		</div>
		<VncViewer />
	</div>
{/if}

<style>
	.observe { display: flex; flex-direction: column; gap: 0; }
	.obs-header { display: flex; align-items: center; justify-content: space-between; padding: 0.5em 0; }
	.obs-title { font-weight: 700; font-size: 0.9em; }
	.obs-hint { font-size: 0.78em; color: var(--text-muted); }
	.obs-img-btn { background: none; border: 2px solid var(--border); border-radius: 8px; padding: 0; cursor: pointer; overflow: hidden; display: block; width: 100%; transition: border-color 0.2s; }
	.obs-img-btn:hover { border-color: var(--link); }
	.obs-img { width: 100%; display: block; border-radius: 6px; }
	.obs-error { padding: 3em; text-align: center; color: var(--text-muted); font-size: 0.9em; background: var(--code-bg); border-radius: 8px; }
	.obs-loading { padding: 3em; text-align: center; color: var(--text-muted); font-size: 0.9em; }
	.interactive { display: flex; flex-direction: column; }
	.int-header { display: flex; align-items: center; justify-content: space-between; padding: 0.5em 0; }
	.int-title { font-weight: 700; font-size: 0.9em; }
	.int-back { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 0.25em 0.6em; font-size: 0.78em; cursor: pointer; color: var(--text-muted); }
	.int-back:hover { color: var(--text); background: var(--code-bg); }
</style>

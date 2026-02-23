<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let { fps = 2 } = $props();
	let src = $state('');
	let error = $state(false);
	let timer;

	async function refresh() {
		try {
			const res = await fetch('/api/screen');
			if (!res.ok) { error = true; return; }
			const blob = await res.blob();
			if (src) URL.revokeObjectURL(src);
			src = URL.createObjectURL(blob);
			error = false;
		} catch { error = true; }
	}

	onMount(() => {
		if (!browser) return;
		refresh();
		timer = setInterval(refresh, 1000 / fps);
	});
	onDestroy(() => { clearInterval(timer); if (src) URL.revokeObjectURL(src); });
</script>

<a href="/screen" class="preview" title="Open interactive screen">
	{#if error}
		<div class="placeholder">Screen unavailable</div>
	{:else if src}
		<img {src} alt="Screen" />
	{:else}
		<div class="placeholder">Loading...</div>
	{/if}
</a>

<style>
	.preview { display: block; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: #000; cursor: pointer; text-decoration: none; }
	.preview:hover { border-color: var(--text-muted); }
	img { width: 100%; display: block; }
	.placeholder { padding: 2em; text-align: center; color: var(--text-muted); font-size: 0.85em; }
</style>

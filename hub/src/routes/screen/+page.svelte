<script>
	import ScreenStream from '$lib/components/ScreenStream.svelte';
</script>

<svelte:head><title>Screen — Relaygent</title></svelte:head>

<div class="screen-page">
	<ScreenStream fps={10} />
</div>

<style>
	.screen-page { height: 100vh; display: flex; flex-direction: column; background: #000; padding: 0; }
	.screen-page :global(.stream) { flex: 1; border: none; border-radius: 0; }
	.screen-page :global(.stream-header) { background: #111; border-bottom: 1px solid #333; }
	.screen-page :global(.frame) { flex: 1; }
	.screen-page :global(.frame img) { width: 100%; height: 100%; object-fit: contain; }
</style>

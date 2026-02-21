<script>
	import ScreenStream from '$lib/components/ScreenStream.svelte';
</script>

<svelte:head><title>Screen | Relaygent</title></svelte:head>

<div class="screen-page">
	<ScreenStream fps={6} />
</div>

<style>
	.screen-page { max-width: 1400px; margin: 0 auto; }
</style>

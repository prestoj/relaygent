<script>
	import VncViewer from '$lib/components/VncViewer.svelte';
	import ScreenStream from '$lib/components/ScreenStream.svelte';

	let vncFailed = $state(false);
</script>

<svelte:head><title>Screen — Relaygent</title></svelte:head>

{#if vncFailed}
	<ScreenStream />
{:else}
	<VncViewer onfail={() => { vncFailed = true; }} />
{/if}

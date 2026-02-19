<script>
	let { data } = $props();
</script>

<svelte:head><title>Digests — Relaygent</title></svelte:head>

<h1>Daily Digests</h1>

{#if data.dates.length === 0}
	<p style="color: var(--text-muted)">No digests found. Digests generate daily at noon.</p>
{:else}
	<ul class="digest-list">
		{#each data.dates as date}
			<li><a href="/digest/{date}">{date}</a></li>
		{/each}
	</ul>
{/if}

<style>
	h1 { margin-top: 0; }
	.digest-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.4em; }
	.digest-list a { font-size: 1.05em; font-family: monospace; }
</style>

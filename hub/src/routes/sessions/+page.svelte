<script>
	let { data } = $props();
	function fmtSize(b) {
		if (b < 1024) return `${b}B`;
		if (b < 1024 * 1024) return `${(b/1024).toFixed(0)}KB`;
		return `${(b/1024/1024).toFixed(1)}MB`;
	}
</script>

<svelte:head><title>Sessions — Relaygent</title></svelte:head>

<h1>Relay Sessions</h1>

{#if data.sessions.length === 0}
	<p style="color: var(--text-muted)">No sessions found.</p>
{:else}
	<ul class="session-list">
		{#each data.sessions as s, i}
			<li class:current={i === 0}>
				<a href="/sessions/{s.id}">{s.displayTime}</a>
				<span class="meta">{fmtSize(s.size)}{i === 0 ? ' · current' : ''}</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h1 { margin-top: 0; }
	.session-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.3em; }
	.session-list li { display: flex; align-items: baseline; gap: 0.75em; }
	.session-list a { font-family: monospace; font-size: 1.05em; }
	.meta { font-size: 0.8em; color: var(--text-muted); }
	.current a { font-weight: 600; }
</style>

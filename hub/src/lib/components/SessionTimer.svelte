<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	let sessionStart = $state(null);
	let now = $state(Date.now());
	let interval;

	async function fetchStart() {
		try {
			const d = await (await fetch('/api/relay?limit=1')).json();
			if (d.sessionStart) sessionStart = new Date(d.sessionStart).getTime();
		} catch { /* ignore */ }
	}

	function fmtElapsed(ms) {
		const m = Math.floor((now - ms) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	}

	onMount(() => {
		if (!browser) return;
		fetchStart();
		interval = setInterval(() => { now = Date.now(); fetchStart(); }, 60000);
	});
	onDestroy(() => clearInterval(interval));
</script>

{#if sessionStart}
<div class="sess-timer">Session {fmtElapsed(sessionStart)}</div>
{/if}

<style>
	.sess-timer { font-size: 0.75em; color: var(--text-muted); margin-bottom: 0.75em; }
</style>

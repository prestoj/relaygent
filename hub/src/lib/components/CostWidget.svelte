<script>
	import { onMount } from 'svelte';
	let cost = $state(null);
	let todayCost = $state(0);

	onMount(async () => {
		try {
			const res = await fetch('/api/cost?days=7');
			if (!res.ok) return;
			const data = await res.json();
			cost = data;
			const today = new Date().toISOString().slice(0, 10);
			const todayEntry = data.perDay?.find(d => d.date === today);
			todayCost = todayEntry?.cost || 0;
		} catch { /* ignore */ }
	});
</script>

{#if cost}
<div class="cost-bar">
	<span class="cost-label">Cost</span>
	<span class="cost-value">Today <strong>${todayCost.toFixed(0)}</strong></span>
	<span class="cost-sep">|</span>
	<span class="cost-value">7d <strong>${cost.cost.toFixed(0)}</strong></span>
	<span class="cost-sep">|</span>
	<span class="cost-sessions">{cost.sessions} sessions</span>
</div>
{/if}

<style>
	.cost-bar { display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.8em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.78em; color: var(--text-muted); margin-bottom: 0.75em; }
	.cost-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.85em; }
	.cost-value strong { color: var(--text); font-weight: 600; }
	.cost-sep { opacity: 0.3; }
	.cost-sessions { opacity: 0.7; }
</style>

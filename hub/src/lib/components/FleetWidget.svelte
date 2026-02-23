<script>
	import { onMount } from 'svelte';
	let peers = $state([]);
	let error = $state(false);

	async function refresh() {
		try {
			const r = await fetch('/api/fleet');
			if (r.ok) { peers = await r.json(); error = false; }
		} catch { error = true; }
	}

	onMount(() => { refresh(); const iv = setInterval(refresh, 15000); return () => clearInterval(iv); });

	function badge(h) {
		if (!h) return ['down', 'Down'];
		const s = h.relay?.status;
		if (s === 'working') return ['ok', 'Working'];
		if (s === 'sleeping') return ['warn', 'Sleeping'];
		return ['off', s || 'Off'];
	}
</script>

{#if peers.length > 1}
<section class="fleet-w">
	<a href="/fleet" class="fleet-title">Fleet</a>
	<div class="fleet-peers">
		{#each peers as p}
			{@const [cls, label] = badge(p.health)}
			<div class="fp">
				<span class="fp-name">{p.health?.hostname || p.name}</span>
				<span class="fp-badge {cls}">{label}</span>
				{#if p.session?.active}<span class="fp-ctx">{Math.round(p.session.contextPct || 0)}%</span>{/if}
			</div>
		{/each}
	</div>
</section>
{/if}

<style>
	.fleet-w { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.5em 0.75em; margin-bottom: 0.75em; }
	.fleet-title { font-weight: 700; font-size: 0.8em; color: var(--text-muted); text-decoration: none; text-transform: uppercase; letter-spacing: 0.04em; }
	.fleet-title:hover { color: var(--link); }
	.fleet-peers { display: flex; gap: 1em; margin-top: 0.35em; flex-wrap: wrap; }
	.fp { display: flex; align-items: center; gap: 0.4em; }
	.fp-name { font-weight: 600; font-size: 0.85em; }
	.fp-badge { font-size: 0.68em; padding: 0.1em 0.4em; border-radius: 8px; font-weight: 600; }
	.fp-badge.ok { background: var(--success); color: white; }
	.fp-badge.warn { background: var(--warning); color: #333; }
	.fp-badge.off { background: var(--text-muted); color: white; }
	.fp-badge.down { background: var(--error); color: white; }
	.fp-ctx { font-size: 0.75em; color: var(--text-muted); font-family: monospace; }
</style>

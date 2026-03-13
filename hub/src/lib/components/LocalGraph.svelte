<script>
	import { goto } from '$app/navigation';
	let { slug, title, links = [], backlinks = [] } = $props();
	let hovered = $state(null);

	// Deduplicate: a topic can be both a forward link and backlink
	const backSlugs = new Set(backlinks.map(b => b.slug));
	const fwdOnly = links.filter(l => !backSlugs.has(l.slug));
	const all = [
		...fwdOnly.map(l => ({ ...l, dir: 'fwd' })),
		...backlinks.map(b => ({ ...b, dir: backSlugs.has(b.slug) && links.some(l => l.slug === b.slug) ? 'both' : 'back' })),
	];

	const W = 400, H = 280, CX = W / 2, CY = H / 2;
	const R = Math.min(W, H) * 0.35;
	const positions = all.map((n, i) => {
		const angle = (i / all.length) * Math.PI * 2 - Math.PI / 2;
		return { x: CX + Math.cos(angle) * R, y: CY + Math.sin(angle) * R };
	});

	function dirColor(dir) {
		return dir === 'fwd' ? '#3b82f6' : dir === 'back' ? '#8b5cf6' : '#22c55e';
	}
	function label(n) { return (n.title || n.slug).replace(/-/g, ' '); }
</script>

{#if all.length > 0}
<div class="local-graph-wrap">
	<div class="lg-label">Connections</div>
	<svg viewBox="0 0 {W} {H}" class="lg">
		{#each all as n, i}
			<line x1={CX} y1={CY} x2={positions[i].x} y2={positions[i].y}
				stroke={dirColor(n.dir)} stroke-width={hovered === i ? 1.5 : 0.8}
				opacity={hovered === i ? 0.6 : 0.25} />
		{/each}
		<!-- Center node -->
		<circle cx={CX} cy={CY} r={8} fill="var(--link)" opacity="0.9" />
		<text x={CX} y={CY + 22} text-anchor="middle" font-size="9"
			fill="var(--text)" font-weight="600" font-family="system-ui">{label({title, slug})}</text>
		<!-- Neighbor nodes -->
		{#each all as n, i}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g class="lg-node" onmouseenter={() => hovered = i} onmouseleave={() => hovered = null}
				onclick={() => goto(`/kb/${n.slug}`)}>
				<circle cx={positions[i].x} cy={positions[i].y} r={5} fill={dirColor(n.dir)}
					opacity={hovered === i ? 1 : 0.7} stroke={hovered === i ? '#fff' : 'none'} stroke-width="1" />
				{#if hovered === i}
					<text x={positions[i].x} y={positions[i].y - 10} text-anchor="middle"
						font-size="9" fill="var(--text)" font-family="system-ui">{label(n)}</text>
				{/if}
			</g>
		{/each}
	</svg>
	<div class="lg-legend">
		<span class="lg-dot" style="background:#3b82f6"></span> links to
		<span class="lg-dot" style="background:#8b5cf6"></span> linked from
		<span class="lg-dot" style="background:#22c55e"></span> both
	</div>
</div>
{/if}

<style>
	.local-graph-wrap { margin: 1.5em 0; }
	.lg-label { font-size: 0.8em; color: var(--text-muted); text-transform: uppercase;
		letter-spacing: 0.05em; margin-bottom: 0.3em; }
	.lg { width: 100%; max-width: 400px; height: auto; border: 1px solid var(--border);
		border-radius: 8px; background: var(--bg-surface); }
	.lg-node { cursor: pointer; }
	.lg-legend { display: flex; gap: 0.8em; align-items: center; font-size: 0.72em;
		color: var(--text-muted); margin-top: 0.3em; }
	.lg-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.2em; }
</style>

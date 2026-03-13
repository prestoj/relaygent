<script>
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	let nodes = $state([]);
	let edges = $state([]);
	let hovered = $state(null);
	let frame;
	let ticks = 0;
	const MAX_TICKS = 250;
	const W = 900, H = 550;

	const TAG_COLORS = {
		meta: '#8b5cf6', creative: '#ec4899', system: '#f59e0b',
		research: '#3b82f6', preston: '#22c55e', video: '#ec4899',
		continuity: '#8b5cf6', exploration: '#14b8a6',
	};
	const DEFAULT_COLOR = '#6b7280';
	function nodeColor(n) { return TAG_COLORS[(n.tags || [])[0]] || DEFAULT_COLOR; }
	function nodeR(n) { return 4 + Math.min(n.lc || 0, 12) * 1.2; }

	onMount(async () => {
		try {
			const res = await fetch('/api/kb/graph');
			const data = await res.json();
			const idx = {};
			nodes = data.nodes.map((n, i) => {
				idx[n.slug] = i;
				return {
					...n, lc: 0,
					x: W / 2 + (Math.random() - 0.5) * W * 0.5,
					y: H / 2 + (Math.random() - 0.5) * H * 0.5,
					vx: 0, vy: 0,
				};
			});
			edges = data.edges
				.map(e => ({ s: idx[e.source] ?? -1, t: idx[e.target] ?? -1 }))
				.filter(e => e.s >= 0 && e.t >= 0);
			for (const e of edges) { nodes[e.s].lc++; nodes[e.t].lc++; }
			tick();
		} catch {}
	});

	function tick() {
		if (ticks >= MAX_TICKS) return;
		ticks++;
		const alpha = 0.3 * (1 - ticks / MAX_TICKS);
		const N = nodes.length;

		// Repulsion (O(n²) — fine for <200 nodes)
		for (let i = 0; i < N; i++) {
			for (let j = i + 1; j < N; j++) {
				let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
				let d = Math.sqrt(dx * dx + dy * dy) || 1;
				let f = 600 / (d * d);
				let fx = dx / d * f, fy = dy / d * f;
				nodes[i].vx += fx; nodes[i].vy += fy;
				nodes[j].vx -= fx; nodes[j].vy -= fy;
			}
		}
		// Attraction along edges
		for (const e of edges) {
			let dx = nodes[e.t].x - nodes[e.s].x, dy = nodes[e.t].y - nodes[e.s].y;
			let d = Math.sqrt(dx * dx + dy * dy) || 1;
			let f = d * 0.015;
			let fx = dx / d * f, fy = dy / d * f;
			nodes[e.s].vx += fx; nodes[e.s].vy += fy;
			nodes[e.t].vx -= fx; nodes[e.t].vy -= fy;
		}
		// Centering
		for (const n of nodes) {
			n.vx += (W / 2 - n.x) * 0.008;
			n.vy += (H / 2 - n.y) * 0.008;
			n.vx *= 0.75; n.vy *= 0.75;
			n.x += n.vx * alpha; n.y += n.vy * alpha;
			n.x = Math.max(40, Math.min(W - 40, n.x));
			n.y = Math.max(30, Math.min(H - 30, n.y));
		}
		nodes = nodes; // trigger reactivity
		frame = requestAnimationFrame(tick);
	}

	onDestroy(() => cancelAnimationFrame(frame));
</script>

<svg viewBox="0 0 {W} {H}" class="graph" role="img" aria-label="Knowledge base topic graph">
	{#each edges as e}
		<line x1={nodes[e.s]?.x} y1={nodes[e.s]?.y} x2={nodes[e.t]?.x} y2={nodes[e.t]?.y}
			stroke="var(--border)" stroke-width="0.7" opacity="0.35" />
	{/each}
	{#each nodes as n, i}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<g class="node" onmouseenter={() => hovered = i} onmouseleave={() => hovered = null}
			onclick={() => goto(`/kb/${n.slug}`)}>
			<circle cx={n.x} cy={n.y} r={nodeR(n)} fill={nodeColor(n)}
				opacity={hovered === i ? 1 : 0.7} stroke={hovered === i ? '#fff' : 'none'}
				stroke-width="1.5" />
			{#if hovered === i}
				<rect x={n.x - (n.title || n.slug).length * 3.2 - 4} y={n.y - nodeR(n) - 20}
					width={(n.title || n.slug).length * 6.4 + 8} height={16} rx={3}
					fill="var(--bg-surface)" stroke="var(--border)" stroke-width="0.5" opacity="0.9" />
				<text x={n.x} y={n.y - nodeR(n) - 8} text-anchor="middle"
					font-size="10" fill="var(--text)" font-family="system-ui, sans-serif">
					{n.title || n.slug}
				</text>
			{/if}
		</g>
	{/each}
</svg>

<style>
	.graph { width: 100%; height: auto; border: 1px solid var(--border);
		border-radius: 8px; background: var(--bg-surface); cursor: default; }
	.node { cursor: pointer; }
	.node:hover circle { filter: brightness(1.2); }
</style>

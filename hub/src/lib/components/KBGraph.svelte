<script>
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	let nodes = $state([]);
	let edges = $state([]);
	let hovered = $state(null);
	let dragging = $state(null);
	let svgEl;
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

	function neighbors(idx) {
		if (idx == null) return new Set();
		const s = new Set([idx]);
		for (const e of edges) { if (e.s === idx) s.add(e.t); if (e.t === idx) s.add(e.s); }
		return s;
	}
	function isConnectedEdge(e, idx) { return idx != null && (e.s === idx || e.t === idx); }
	let hoverNeighbors = $derived(neighbors(hovered));

	function svgPoint(evt) {
		const pt = svgEl.createSVGPoint();
		pt.x = evt.clientX; pt.y = evt.clientY;
		const svgP = pt.matrixTransform(svgEl.getScreenCTM().inverse());
		return { x: svgP.x, y: svgP.y };
	}
	let dragMoved = false;
	function onPointerDown(evt, i) {
		dragging = i; dragMoved = false;
		nodes[i].pinned = true;
		svgEl.setPointerCapture(evt.pointerId);
	}
	function onPointerMove(evt) {
		if (dragging == null) return;
		dragMoved = true;
		const p = svgPoint(evt);
		nodes[dragging].x = Math.max(40, Math.min(W - 40, p.x));
		nodes[dragging].y = Math.max(30, Math.min(H - 30, p.y));
		nodes = nodes;
		if (ticks >= MAX_TICKS) { ticks = MAX_TICKS - 60; tick(); }
	}
	function onPointerUp(evt, i) {
		if (dragging != null) nodes[dragging].pinned = false;
		dragging = null;
		if (!dragMoved && i != null) goto(`/kb/${nodes[i].slug}`);
	}

	onMount(async () => {
		try {
			const res = await fetch('/api/kb/graph');
			const data = await res.json();
			const idx = {};
			nodes = data.nodes.map((n, i) => {
				idx[n.slug] = i;
				return { ...n, lc: 0, pinned: false,
					x: W / 2 + (Math.random() - 0.5) * W * 0.5,
					y: H / 2 + (Math.random() - 0.5) * H * 0.5, vx: 0, vy: 0 };
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
		for (let i = 0; i < N; i++) {
			for (let j = i + 1; j < N; j++) {
				let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
				let d = Math.sqrt(dx * dx + dy * dy) || 1;
				let f = 600 / (d * d);
				let fx = dx / d * f, fy = dy / d * f;
				if (!nodes[i].pinned) { nodes[i].vx += fx; nodes[i].vy += fy; }
				if (!nodes[j].pinned) { nodes[j].vx -= fx; nodes[j].vy -= fy; }
			}
		}
		for (const e of edges) {
			let dx = nodes[e.t].x - nodes[e.s].x, dy = nodes[e.t].y - nodes[e.s].y;
			let d = Math.sqrt(dx * dx + dy * dy) || 1;
			let f = d * 0.015, fx = dx / d * f, fy = dy / d * f;
			if (!nodes[e.s].pinned) { nodes[e.s].vx += fx; nodes[e.s].vy += fy; }
			if (!nodes[e.t].pinned) { nodes[e.t].vx -= fx; nodes[e.t].vy -= fy; }
		}
		for (const n of nodes) {
			if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
			n.vx += (W / 2 - n.x) * 0.008; n.vy += (H / 2 - n.y) * 0.008;
			n.vx *= 0.75; n.vy *= 0.75;
			n.x += n.vx * alpha; n.y += n.vy * alpha;
			n.x = Math.max(40, Math.min(W - 40, n.x));
			n.y = Math.max(30, Math.min(H - 30, n.y));
		}
		nodes = nodes;
		frame = requestAnimationFrame(tick);
	}

	onDestroy(() => cancelAnimationFrame(frame));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg viewBox="0 0 {W} {H}" class="graph" role="img" aria-label="Knowledge base topic graph"
	bind:this={svgEl} onpointermove={onPointerMove} onpointerup={() => onPointerUp(null, null)}>
	{#each edges as e}
		<line x1={nodes[e.s]?.x} y1={nodes[e.s]?.y} x2={nodes[e.t]?.x} y2={nodes[e.t]?.y}
			stroke={hovered != null && isConnectedEdge(e, hovered) ? 'var(--link)' : 'var(--border)'}
			stroke-width={hovered != null && isConnectedEdge(e, hovered) ? 1.5 : 0.7}
			opacity={hovered != null ? (isConnectedEdge(e, hovered) ? 0.7 : 0.1) : 0.35} />
	{/each}
	{#each nodes as n, i}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<g class="node" onmouseenter={() => { if (dragging == null) hovered = i; }}
			onmouseleave={() => { if (dragging == null) hovered = null; }}
			onpointerdown={(evt) => onPointerDown(evt, i)}
			onpointerup={(evt) => onPointerUp(evt, i)}>
			<circle cx={n.x} cy={n.y} r={hovered === i ? nodeR(n) + 2 : nodeR(n)} fill={nodeColor(n)}
				opacity={hovered != null ? (hoverNeighbors.has(i) ? 1 : 0.15) : 0.7}
				stroke={hovered === i ? '#fff' : 'none'} stroke-width="1.5" />
			{#if hovered === i || (hovered != null && hoverNeighbors.has(i) && (n.lc || 0) > 0)}
				<text x={n.x} y={n.y - nodeR(n) - 6} text-anchor="middle"
					font-size={hovered === i ? 11 : 9} font-weight={hovered === i ? 600 : 400}
					fill="var(--text)" font-family="system-ui, sans-serif"
					style="paint-order: stroke; stroke: var(--bg-surface); stroke-width: 3px;">
					{n.title || n.slug}
				</text>
			{/if}
		</g>
	{/each}
</svg>

<style>
	.graph { width: 100%; height: auto; border: 1px solid var(--border);
		border-radius: 8px; background: var(--bg-surface); cursor: grab; touch-action: none; }
	.graph:active { cursor: grabbing; }
	.node { cursor: pointer; }
	.node:hover circle { filter: brightness(1.2); }
</style>

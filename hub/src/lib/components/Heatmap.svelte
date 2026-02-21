<script>
	import { onMount } from 'svelte';
	let days = $state([]);
	let total = $state(0);
	let loading = $state(true);
	let tooltip = $state({ show: false, text: '', x: 0, y: 0 });

	onMount(async () => {
		try {
			const d = await (await fetch('/api/heatmap')).json();
			days = d.days || [];
			total = d.total || 0;
		} catch { /* ignore */ }
		loading = false;
	});

	function intensity(count) {
		if (count === 0) return 0;
		if (count <= 2) return 1;
		if (count <= 5) return 2;
		if (count <= 10) return 3;
		return 4;
	}

	// Group days into weeks (columns)
	let weeks = $derived.by(() => {
		const w = [];
		let cur = [];
		for (const d of days) {
			if (d.dow === 0 && cur.length > 0) { w.push(cur); cur = []; }
			cur.push(d);
		}
		if (cur.length > 0) w.push(cur);
		return w;
	});

	function showTip(e, d) {
		const r = e.target.getBoundingClientRect();
		tooltip = { show: true, text: `${d.date}: ${d.count} session${d.count !== 1 ? 's' : ''}`, x: r.left + r.width / 2, y: r.top - 8 };
	}
	function hideTip() { tooltip = { ...tooltip, show: false }; }
</script>

{#if !loading && days.length > 0}
<section class="heatmap-widget">
	<div class="hm-hdr">
		<span class="hm-title">Activity</span>
		<span class="hm-total">{total} sessions</span>
	</div>
	<div class="hm-grid">
		<div class="hm-labels">
			<span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span>
		</div>
		{#each weeks as week}
			<div class="hm-col">
				{#each week as d}
					<div class="hm-cell l{intensity(d.count)}"
						onmouseenter={(e) => showTip(e, d)} onmouseleave={hideTip}
						role="presentation"></div>
				{/each}
			</div>
		{/each}
	</div>
	<div class="hm-legend">
		<span class="hm-leg-label">Less</span>
		<div class="hm-cell l0"></div>
		<div class="hm-cell l1"></div>
		<div class="hm-cell l2"></div>
		<div class="hm-cell l3"></div>
		<div class="hm-cell l4"></div>
		<span class="hm-leg-label">More</span>
	</div>
</section>
{/if}

{#if tooltip.show}
<div class="hm-tip" style="left:{tooltip.x}px;top:{tooltip.y}px">{tooltip.text}</div>
{/if}

<style>
	.heatmap-widget { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 0.8em; margin-bottom: 1em; }
	.hm-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4em; }
	.hm-title { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
	.hm-total { font-size: 0.72em; color: var(--text-muted); }
	.hm-grid { display: flex; gap: 2px; overflow-x: auto; padding: 0.2em 0; }
	.hm-labels { display: flex; flex-direction: column; gap: 2px; margin-right: 2px; }
	.hm-labels span { height: 11px; font-size: 0.55em; color: var(--text-muted); line-height: 11px; text-align: right; padding-right: 2px; }
	.hm-col { display: flex; flex-direction: column; gap: 2px; }
	.hm-cell { width: 11px; height: 11px; border-radius: 2px; }
	.l0 { background: var(--code-bg); }
	.l1 { background: #9be9a8; }
	.l2 { background: #40c463; }
	.l3 { background: #30a14e; }
	.l4 { background: #216e39; }
	:global(.dark) .l1 { background: #0e4429; }
	:global(.dark) .l2 { background: #006d32; }
	:global(.dark) .l3 { background: #26a641; }
	:global(.dark) .l4 { background: #39d353; }
	.hm-legend { display: flex; align-items: center; gap: 2px; margin-top: 0.4em; justify-content: flex-end; }
	.hm-leg-label { font-size: 0.6em; color: var(--text-muted); margin: 0 2px; }
	.hm-tip { position: fixed; transform: translateX(-50%) translateY(-100%); background: var(--text); color: var(--bg); padding: 0.25em 0.5em; border-radius: 4px; font-size: 0.72em; white-space: nowrap; pointer-events: none; z-index: 999; }
</style>

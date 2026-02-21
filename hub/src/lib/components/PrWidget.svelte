<script>
	import { onMount } from 'svelte';
	let prs = $state([]);
	let loading = $state(true);
	async function fetchPrs() {
		try {
			const d = await (await fetch('/api/prs')).json();
			prs = d.prs || [];
		} catch { /* ignore */ }
		loading = false;
	}
	onMount(() => { fetchPrs(); });
	function reviewBadge(r) {
		if (r === 'APPROVED') return { cls: 'approved', label: 'Approved' };
		if (r === 'CHANGES_REQUESTED') return { cls: 'changes', label: 'Changes' };
		return { cls: 'pending', label: 'Review' };
	}
</script>

{#if !loading && prs.length > 0}
<section class="pr-widget">
	<div class="pr-hdr">Open PRs</div>
	{#each prs as pr}
		<div class="pr-row">
			<span class="pr-num">#{pr.number}</span>
			<span class="pr-title">{pr.title}</span>
			<span class="pr-badge {reviewBadge(pr.review).cls}">{reviewBadge(pr.review).label}</span>
		</div>
	{/each}
</section>
{/if}

<style>
	.pr-widget { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 0.8em; margin-bottom: 1em; }
	.pr-hdr { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.4em; }
	.pr-row { display: flex; align-items: center; gap: 0.5em; padding: 0.25em 0; font-size: 0.85em; }
	.pr-num { font-family: monospace; font-weight: 600; color: var(--link); min-width: 3em; }
	.pr-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
	.pr-badge { font-size: 0.72em; padding: 0.1em 0.4em; border-radius: 8px; font-weight: 600; }
	.pr-badge.approved { background: #dcfce7; color: #16a34a; }
	.pr-badge.changes { background: #fef3c7; color: #d97706; }
	.pr-badge.pending { background: var(--code-bg); color: var(--text-muted); }
</style>

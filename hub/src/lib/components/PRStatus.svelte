<script>
	import { onMount, onDestroy } from 'svelte';
	let prs = $state([]);
	let pollInterval;
	async function refresh() {
		try { const d = await (await fetch('/api/prs')).json(); prs = d.prs || []; } catch { /* ignore */ }
	}
	onMount(() => { refresh(); pollInterval = setInterval(refresh, 60_000); });
	onDestroy(() => clearInterval(pollInterval));
	function ciClass(ci) { return ci === 'pass' ? 'ci-pass' : ci === 'fail' ? 'ci-fail' : ci === 'pending' ? 'ci-pending' : ''; }
	function reviewLabel(r) { return r === 'APPROVED' ? 'Approved' : r === 'CHANGES_REQUESTED' ? 'Changes' : 'Review'; }
	function reviewClass(r) { return r === 'APPROVED' ? 'rv-ok' : r === 'CHANGES_REQUESTED' ? 'rv-changes' : 'rv-pending'; }
</script>

{#if prs.length > 0}
<section class="pr-section">
	<h3>Pull Requests</h3>
	{#each prs as pr}
		<div class="pr-row">
			<span class="pr-num">#{pr.number}</span>
			<span class="pr-title">{pr.title}</span>
			<span class="pr-meta">
				<span class="pr-ci {ciClass(pr.ci)}" title={pr.ciDetail}>{pr.ci === 'pass' ? 'CI ok' : pr.ci === 'fail' ? 'CI fail' : pr.ci === 'pending' ? 'CI ...' : ''}</span>
				<span class="pr-rv {reviewClass(pr.review)}">{reviewLabel(pr.review)}</span>
				<span class="pr-age">{pr.age}</span>
			</span>
		</div>
	{/each}
</section>
{/if}

<style>
	.pr-section { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 1em; margin-bottom: 1em; }
	h3 { margin: 0 0 0.4em; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
	.pr-row { display: flex; align-items: center; gap: 0.5em; padding: 0.3em 0; font-size: 0.88em; border-bottom: 1px solid var(--border); }
	.pr-row:last-child { border-bottom: none; }
	.pr-num { font-weight: 600; color: var(--link); font-size: 0.85em; min-width: 2.5em; }
	.pr-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.pr-meta { display: flex; gap: 0.4em; align-items: center; white-space: nowrap; }
	.pr-ci, .pr-rv { font-size: 0.75em; padding: 0.1em 0.4em; border-radius: 4px; font-weight: 600; }
	.ci-pass { background: #dcfce7; color: #16a34a; } .ci-fail { background: #fee2e2; color: #dc2626; } .ci-pending { background: #fef3c7; color: #d97706; }
	.rv-ok { background: #dcfce7; color: #16a34a; } .rv-changes { background: #fee2e2; color: #dc2626; } .rv-pending { background: var(--code-bg); color: var(--text-muted); }
	.pr-age { font-size: 0.75em; color: var(--text-muted); }
</style>

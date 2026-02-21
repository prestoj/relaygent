<script>
	let { activities = [] } = $props();
	let todos = $derived.by(() => {
		for (const a of activities) {
			if (a.name === 'TodoWrite' && a.params?.todos?.length) return a.params.todos;
		}
		return [];
	});
	let inProgress = $derived(todos.filter(t => t.status === 'in_progress'));
	let pending = $derived(todos.filter(t => t.status === 'pending'));
	let completed = $derived(todos.filter(t => t.status === 'completed'));
	let ordered = $derived([...inProgress, ...pending, ...completed]);
</script>

{#if ordered.length > 0}
<section class="tw">
	<div class="tw-hdr">Agent Tasks</div>
	<div class="tw-list">
		{#each ordered as t}
			<div class="tw-item" class:done={t.status === 'completed'} class:active={t.status === 'in_progress'}>
				<span class="tw-icon">{t.status === 'completed' ? '\u2713' : t.status === 'in_progress' ? '\u25B8' : '\u25CB'}</span>
				<span class="tw-text">{t.status === 'in_progress' ? (t.activeForm || t.content) : t.content}</span>
			</div>
		{/each}
	</div>
</section>
{/if}

<style>
	.tw { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 1em; margin-bottom: 1em; }
	.tw-hdr { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.4em; }
	.tw-list { display: flex; flex-direction: column; gap: 0.25em; }
	.tw-item { display: flex; align-items: baseline; gap: 0.5em; font-size: 0.85em; color: var(--text-muted); }
	.tw-item.active { color: var(--text); font-weight: 500; }
	.tw-item.done { text-decoration: line-through; opacity: 0.5; }
	.tw-icon { font-size: 0.9em; min-width: 1em; text-align: center; flex-shrink: 0; }
	.tw-item.active .tw-icon { color: var(--link); }
	.tw-item.done .tw-icon { color: #22c55e; }
</style>

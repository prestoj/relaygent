<script>
	let { data } = $props();
	let recurring = $state(data.recurring || []);
	let oneoff = $state(data.oneoff || []);
	let newTask = $state('');
	let adding = $state(false);
	let error = $state('');

	function formatDue(task) {
		if (!task.nextDue) return '—';
		if (task.last === 'never' || !task.last) return 'overdue (never done)';
		const m = task.minsLate;
		if (m === null) {
			const diff = new Date(task.nextDue) - new Date();
			const h = Math.round(diff / 3600000);
			if (h < 24) return `in ${h}h`;
			return `in ${Math.round(h / 24)}d`;
		}
		if (m < 60) return `${m}m overdue`;
		if (m < 1440) return `${Math.round(m / 60)}h overdue`;
		return `${Math.round(m / 1440)}d overdue`;
	}

	async function addTask() {
		if (!newTask.trim() || adding) return;
		adding = true; error = '';
		try {
			const res = await fetch('/api/tasks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: newTask.trim() }),
			});
			if (res.ok) {
				oneoff = [...oneoff, { description: newTask.trim(), type: 'one-off', checked: false, due: false }];
				newTask = '';
			} else { error = 'Failed to add task'; }
		} catch { error = 'Network error'; }
		adding = false;
	}

	async function removeTask(desc) {
		try {
			const res = await fetch('/api/tasks', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: desc }),
			});
			if (res.ok) oneoff = oneoff.filter(t => t.description !== desc);
		} catch { /* ignore */ }
	}

	function handleKey(e) { if (e.key === 'Enter') addTask(); }
</script>

<svelte:head><title>Tasks — Relaygent</title></svelte:head>

<h1>Tasks</h1>

<section class="section">
	<h2>Recurring</h2>
	{#if recurring.length === 0}
		<p class="empty">No recurring tasks.</p>
	{:else}
		<div class="task-list">
			{#each recurring as t}
				<div class="task" class:due={t.due}>
					<div class="task-desc">{t.description}</div>
					<div class="task-meta">
						<span class="freq">{t.freq}</span>
						<span class="due-label" class:overdue={t.due}>{formatDue(t)}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<section class="section">
	<h2>One-off</h2>
	<div class="add-row">
		<input
			type="text"
			placeholder="Add a task for the agent..."
			bind:value={newTask}
			onkeydown={handleKey}
			disabled={adding}
		/>
		<button onclick={addTask} disabled={adding || !newTask.trim()}>Add</button>
	</div>
	{#if error}<p class="error">{error}</p>{/if}
	{#if oneoff.length === 0}
		<p class="empty">No one-off tasks.</p>
	{:else}
		<div class="task-list">
			{#each oneoff as t}
				<div class="task oneoff">
					<div class="task-desc">{t.description}</div>
					<button class="done-btn" onclick={() => removeTask(t.description)} title="Mark done">✓</button>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	h1 { margin-bottom: 0.25em; }
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.section { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1.25em; }
	.task-list { display: flex; flex-direction: column; gap: 0.5em; }
	.task { display: flex; align-items: center; justify-content: space-between; gap: 1em; padding: 0.5em 0.75em; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
	.task.due { border-color: #f97316; background: color-mix(in srgb, #f97316 8%, var(--bg)); }
	.task-desc { flex: 1; font-size: 0.9em; }
	.task-meta { display: flex; gap: 0.75em; align-items: center; white-space: nowrap; font-size: 0.8em; color: var(--text-muted); }
	.freq { background: var(--code-bg); border-radius: 4px; padding: 0.1em 0.4em; font-family: monospace; }
	.due-label { color: var(--text-muted); }
	.due-label.overdue { color: #f97316; font-weight: 600; }
	.add-row { display: flex; gap: 0.5em; margin-bottom: 0.75em; }
	.add-row input { flex: 1; padding: 0.45em 0.75em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.9em; }
	.add-row input:focus { outline: none; border-color: var(--link); }
	.add-row button { padding: 0.45em 1em; background: var(--link); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9em; }
	.add-row button:disabled { opacity: 0.5; cursor: not-allowed; }
	.done-btn { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0.2em 0.5em; cursor: pointer; color: #22c55e; font-size: 0.9em; }
	.done-btn:hover { background: var(--code-bg); }
	.empty { color: var(--text-muted); font-size: 0.88em; margin: 0; }
	.error { color: #ef4444; font-size: 0.85em; margin: 0.25em 0; }
	.oneoff { background: var(--bg); }
</style>

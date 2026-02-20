<script>
	let { initial = [] } = $props();
	let reminders = $state(initial);
	let newMsg = $state('');
	let newTime = $state('');
	let creating = $state(false);

	function formatTime(iso) {
		try {
			return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		} catch { return iso; }
	}
	function isPast(iso) { try { return new Date(iso) <= new Date(); } catch { return false; } }

	async function refresh() {
		try {
			const d = await (await fetch('/api/notifications')).json();
			reminders = d.reminders || [];
		} catch { /* ignore */ }
	}

	export async function poll() { await refresh(); }

	async function create() {
		if (!newMsg.trim() || !newTime) return;
		creating = true;
		try {
			const res = await fetch('/api/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trigger_time: new Date(newTime).toISOString(), message: newMsg.trim() }),
			});
			if (res.ok) { newMsg = ''; newTime = ''; await refresh(); }
		} catch { /* ignore */ }
		creating = false;
	}

	async function cancel(id) {
		try {
			await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
			await refresh();
		} catch { /* ignore */ }
	}
</script>

<div class="add-row">
	<input type="text" placeholder="Reminder message..." bind:value={newMsg} class="msg-input" />
	<input type="datetime-local" bind:value={newTime} class="time-input" />
	<button onclick={create} disabled={creating || !newMsg.trim() || !newTime}>
		{creating ? 'Setting...' : 'Set'}
	</button>
</div>
{#if reminders.length === 0}
	<p class="empty">No pending reminders.</p>
{:else}
	<div class="reminder-list">
		{#each reminders as r (r.id)}
			<div class="item" class:due={isPast(r.trigger_time)}>
				<div class="info">
					<span class="msg">{r.message}</span>
					<span class="time">
						{formatTime(r.trigger_time)}
						{#if r.recurrence}<span class="badge">{r.recurrence}</span>{/if}
						{#if isPast(r.trigger_time)}<span class="badge due-badge">due</span>{/if}
					</span>
				</div>
				<button class="del-btn" onclick={() => cancel(r.id)} title="Cancel">✕</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.add-row { display: flex; gap: 0.5em; margin-bottom: 0.75em; flex-wrap: wrap; }
	.msg-input { flex: 1; min-width: 140px; padding: 0.45em 0.75em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.9em; }
	.msg-input:focus { outline: none; border-color: var(--link); }
	.time-input { padding: 0.45em 0.5em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.85em; }
	.add-row button { padding: 0.45em 1em; background: var(--link); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9em; white-space: nowrap; }
	.add-row button:disabled { opacity: 0.5; cursor: not-allowed; }
	.reminder-list { display: flex; flex-direction: column; gap: 0.5em; }
	.item { display: flex; align-items: center; justify-content: space-between; gap: 1em; padding: 0.5em 0.75em; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
	.item.due { border-color: #f97316; background: color-mix(in srgb, #f97316 8%, var(--bg)); }
	.info { display: flex; flex-direction: column; gap: 0.1em; flex: 1; }
	.msg { font-size: 0.9em; font-weight: 500; }
	.time { font-size: 0.78em; color: var(--text-muted); }
	.badge { display: inline-block; font-size: 0.75em; padding: 0.1em 0.4em; border-radius: 4px; background: var(--code-bg); margin-left: 0.4em; }
	.due-badge { background: #fef3c7; color: #92400e; }
	.del-btn { background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0.2em 0.5em; cursor: pointer; font-size: 0.85em; color: var(--text-muted); }
	.del-btn:hover { color: #ef4444; border-color: #ef4444; }
	.empty { color: var(--text-muted); font-size: 0.88em; margin: 0; }
</style>

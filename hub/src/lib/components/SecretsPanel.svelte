<script>
	import { onMount } from 'svelte';

	let names = $state([]);
	let loading = $state(true);
	let name = $state('');
	let value = $state('');
	let busy = $state(false);
	let msg = $state('');

	async function refresh() {
		loading = true;
		try {
			const r = await fetch('/api/secrets');
			const d = await r.json();
			names = d.names || [];
		} catch { names = []; }
		loading = false;
	}

	async function add() {
		msg = '';
		const n = name.trim();
		if (!n || !value) { msg = 'Name and value required'; return; }
		busy = true;
		try {
			const r = await fetch('/api/secrets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: n, value }),
			});
			const d = await r.json();
			if (r.ok) {
				msg = `Saved “${n}”`;
				name = ''; value = '';
				await refresh();
			} else {
				msg = d.error || 'Failed to save';
			}
		} catch { msg = 'Request failed'; }
		busy = false;
	}

	async function remove(n) {
		if (!confirm(`Delete secret “${n}”?`)) return;
		busy = true;
		try {
			await fetch(`/api/secrets?name=${encodeURIComponent(n)}`, { method: 'DELETE' });
			await refresh();
		} catch { /* ignore */ }
		busy = false;
	}

	onMount(refresh);
</script>

<section class="card">
	<h2>Secrets</h2>
	<p class="hint">Add a secret here instead of pasting it in chat (chat is logged). Values are
		write-only — stored encrypted and never shown back. Claude reads them via the vault.</p>

	<div class="add-row">
		<input class="in" type="text" placeholder="NAME (e.g. STRIPE_KEY)" bind:value={name}
			disabled={busy} autocomplete="off" spellcheck="false" />
		<input class="in" type="password" placeholder="value" bind:value
			disabled={busy} autocomplete="off" />
		<button class="add-btn" onclick={add} disabled={busy || !name.trim() || !value}>Add</button>
	</div>
	{#if msg}<p class="msg">{msg}</p>{/if}

	{#if loading}
		<p class="empty">Loading…</p>
	{:else if names.length === 0}
		<p class="empty">No secrets stored yet.</p>
	{:else}
		<div class="sec-list">
			{#each names as n (n)}
				<div class="sec-row">
					<span class="sec-name">{n}</span>
					<button class="del-btn" onclick={() => remove(n)} disabled={busy}
						aria-label={`Delete ${n}`}>Delete</button>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1em; }
	.hint { font-size: 0.78em; color: var(--text-muted); margin: 0 0 0.85em; }
	.add-row { display: flex; gap: 0.5em; flex-wrap: wrap; align-items: center; }
	.in { padding: 0.35em 0.6em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.85em; }
	.in[type="text"] { flex: 1 1 12em; font-family: monospace; }
	.in[type="password"] { flex: 2 1 14em; }
	.add-btn { padding: 0.35em 0.9em; border: 1px solid var(--link); border-radius: 6px; background: var(--bg); color: var(--link); font-size: 0.8em; font-weight: 600; cursor: pointer; }
	.add-btn:hover:not(:disabled) { background: var(--link); color: #fff; }
	.add-btn:disabled { opacity: 0.5; cursor: default; }
	.msg { font-size: 0.78em; color: var(--text-muted); margin: 0.6em 0 0; }
	.empty { color: var(--text-muted); font-size: 0.88em; margin: 0.85em 0 0; }
	.sec-list { display: flex; flex-direction: column; gap: 0.4em; margin-top: 0.85em; }
	.sec-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75em; font-size: 0.9em; padding: 0.3em 0.5em; background: var(--bg); border-radius: 4px; border: 1px solid var(--border); }
	.sec-name { font-weight: 600; font-family: monospace; word-break: break-all; }
	.del-btn { padding: 0.2em 0.6em; border: 1px solid var(--error); border-radius: 6px; background: var(--bg); color: var(--error); font-size: 0.75em; cursor: pointer; font-weight: 600; flex-shrink: 0; }
	.del-btn:hover:not(:disabled) { background: var(--error); color: #fff; }
	.del-btn:disabled { opacity: 0.5; cursor: default; }
</style>

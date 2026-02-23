<script>
	let peers = $state([]);
	let newName = $state('');
	let newUrl = $state('');
	let error = $state('');
	let loading = $state(true);

	async function loadPeers() {
		try {
			const cfg = await (await fetch('/api/fleet')).json();
			peers = cfg.filter(p => !p.local);
		} catch { peers = []; }
		loading = false;
	}

	async function addPeer() {
		error = '';
		if (!newName.trim() || !newUrl.trim()) { error = 'Name and URL required'; return; }
		const res = await fetch('/api/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() }) });
		if (!res.ok) { error = (await res.json()).error || 'Failed'; return; }
		newName = ''; newUrl = '';
		await loadPeers();
	}

	async function removePeer(name) {
		const res = await fetch('/api/fleet', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
		if (res.ok) await loadPeers();
	}

	$effect(() => { loadPeers(); });
</script>

<section class="card">
	<h2>Fleet Peers</h2>
	{#if loading}
		<p class="empty">Loading...</p>
	{:else if peers.length === 0}
		<p class="empty">No remote peers configured.</p>
	{:else}
		<div class="peer-list">
			{#each peers as peer}
				<div class="peer-row">
					<span class="peer-name">{peer.name}</span>
					<span class="peer-url">{peer.url}</span>
					<span class="peer-status" class:up={peer.health} class:down={!peer.health}>{peer.health ? 'online' : 'offline'}</span>
					<button class="remove-btn" onclick={() => removePeer(peer.name)} title="Remove peer">&times;</button>
				</div>
			{/each}
		</div>
	{/if}
	<form class="add-form" onsubmit={(e) => { e.preventDefault(); addPeer(); }}>
		<input type="text" bind:value={newName} placeholder="name" class="add-input name-input" />
		<input type="url" bind:value={newUrl} placeholder="https://host:8080" class="add-input url-input" />
		<button type="submit" class="add-btn">Add</button>
	</form>
	{#if error}<p class="error-msg">{error}</p>{/if}
	<p class="hint">Peers appear on the <a href="/fleet">Fleet</a> page</p>
</section>

<style>
	.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1em; }
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.hint { font-size: 0.78em; color: var(--text-muted); margin: 0.75em 0 0; }
	.hint a { color: var(--link); }
	.empty { color: var(--text-muted); font-size: 0.88em; margin: 0 0 0.75em; }
	.peer-list { display: flex; flex-direction: column; gap: 0.4em; margin-bottom: 0.75em; }
	.peer-row { display: flex; align-items: center; gap: 0.6em; font-size: 0.9em; padding: 0.3em 0.5em; background: var(--bg); border-radius: 4px; border: 1px solid var(--border); }
	.peer-name { font-weight: 600; font-family: monospace; white-space: nowrap; }
	.peer-url { color: var(--text-muted); font-family: monospace; font-size: 0.85em; flex: 1; overflow: hidden; text-overflow: ellipsis; }
	.peer-status { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 3px; font-weight: 600; }
	.peer-status.up { color: var(--success); }
	.peer-status.down { color: var(--error); }
	.remove-btn { background: none; border: none; color: var(--error); font-size: 1.1em; cursor: pointer; padding: 0 0.3em; line-height: 1; opacity: 0.6; }
	.remove-btn:hover { opacity: 1; }
	.add-form { display: flex; gap: 0.4em; align-items: center; }
	.add-input { padding: 0.3em 0.5em; border: 1px solid var(--border); border-radius: 4px; font-size: 0.85em; background: var(--bg); color: var(--text); font-family: monospace; }
	.name-input { width: 8em; }
	.url-input { flex: 1; min-width: 12em; }
	.add-btn { padding: 0.3em 0.7em; border: 1px solid var(--link); border-radius: 6px; background: var(--bg); color: var(--link); font-size: 0.78em; cursor: pointer; font-weight: 600; }
	.add-btn:hover { background: var(--link); color: #fff; }
	.error-msg { color: var(--error); font-size: 0.8em; margin: 0.4em 0 0; }
</style>

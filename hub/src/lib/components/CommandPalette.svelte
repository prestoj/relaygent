<script>
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	let open = $state(false);
	let query = $state('');
	let selectedIdx = $state(0);
	let inputEl;

	const pages = [
		{ name: 'Dashboard', path: '/', keys: ['home', 'dash'] },
		{ name: 'Intent', path: '/intent', keys: ['intent', 'goal'] },
		{ name: 'Knowledge Base', path: '/kb', keys: ['kb', 'knowledge', 'wiki'] },
		{ name: 'Tasks', path: '/tasks', keys: ['tasks', 'todo'] },
		{ name: 'Sessions', path: '/sessions', keys: ['sessions', 'history'] },
		{ name: 'Logs', path: '/logs', keys: ['logs', 'debug'] },
		{ name: 'Files', path: '/files', keys: ['files', 'browse'] },
		{ name: 'Search', path: '/search', keys: ['search', 'find'] },
		{ name: 'Notifications', path: '/notifications', keys: ['notifications', 'alerts'] },
		{ name: 'Settings', path: '/settings', keys: ['settings', 'config'] },
		{ name: 'Help', path: '/help', keys: ['help', 'guide', 'shortcuts', 'getting started'] },
	];

	let statusMsg = $state('');
	const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const actions = [
		{ name: 'Open Chat', keys: ['chat', 'message', 'talk'], type: 'action', hint: 'Send a message to the agent', action: () => window.dispatchEvent(new CustomEvent('open-chat')) },
		{ name: 'Start Agent', keys: ['start', 'launch', 'run'], type: 'action', hint: 'Launch the relay agent', action: async () => { await postJson('/api/relay', { action: 'start' }); statusMsg = 'Agent starting...'; } },
		{ name: 'Stop Agent', keys: ['stop', 'kill', 'halt'], type: 'action', hint: 'Stop the relay agent', action: async () => { await postJson('/api/relay', { action: 'stop' }); statusMsg = 'Agent stopping...'; } },
		{ name: 'Health Check', keys: ['health', 'ping', 'check'], type: 'action', hint: 'Ping all services', action: async () => { const r = await postJson('/api/actions', { command: 'health' }); const d = await r.json(); statusMsg = d.output?.split('\n')[0] || 'Done'; } },
	];

	let kbResults = $state([]);
	let debounceTimer;

	async function searchKb(q) {
		if (q.length < 2) { kbResults = []; return; }
		try {
			const d = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
			kbResults = (d.results || []).slice(0, 5).map(t => ({
				name: t.title || t.slug, path: `/kb/${t.slug}`, type: 'kb',
			}));
		} catch { kbResults = []; }
	}

	let results = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) return [...pages, ...actions];
		const matchPages = pages.filter(p => p.name.toLowerCase().includes(q) || p.keys.some(k => k.includes(q)));
		const matchActions = actions.filter(a => a.name.toLowerCase().includes(q) || a.keys.some(k => k.includes(q)));
		return [...matchPages, ...matchActions, ...kbResults];
	});

	$effect(() => { selectedIdx = 0; });
	$effect(() => {
		if (open && inputEl) setTimeout(() => inputEl?.focus(), 10);
	});

	function show() { open = true; query = ''; kbResults = []; selectedIdx = 0; statusMsg = ''; }
	function hide() { open = false; }

	function handleKeydown(e) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open ? hide() : show(); return; }
		if (e.key === '?' && !open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); show(); return; }
		if (!open) return;
		if (e.key === 'Escape') { hide(); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, results.length - 1); }
		if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); }
		if (e.key === 'Enter' && results[selectedIdx]) { navigate(results[selectedIdx]); }
	}

	function navigate(item) {
		hide();
		if (item.type === 'action') { item.action(); return; }
		goto(item.path);
	}

	function onInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => searchKb(query), 200);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
<div class="backdrop" onclick={hide} role="presentation">
	<div class="palette" onclick={(e) => e.stopPropagation()} role="dialog">
		<input bind:this={inputEl} bind:value={query} oninput={onInput}
			placeholder="Search pages, actions, KB topics..." class="palette-input" />
		<ul class="palette-list">
			{#each results as item, i}
				<li class:selected={i === selectedIdx}>
					<button onclick={() => navigate(item)} onmouseenter={() => selectedIdx = i}>
						<span class="item-type" class:action-type={item.type === 'action'}>{item.type === 'kb' ? 'KB' : item.type === 'action' ? 'Run' : 'Page'}</span>
						<span class="item-name">{item.name}</span>
						<span class="item-path">{item.hint || item.path}</span>
					</button>
				</li>
			{/each}
			{#if results.length === 0}
				<li class="empty">No results</li>
			{/if}
		</ul>
		<div class="palette-footer">
			{#if statusMsg}<span class="status-msg">{statusMsg}</span>{:else}<kbd>⌘K</kbd> <kbd>?</kbd> open <kbd>↑↓</kbd> navigate <kbd>↵</kbd> select <kbd>esc</kbd> close{/if}
		</div>
	</div>
</div>
{/if}

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; display: flex; justify-content: center; padding-top: 15vh; }
	.palette { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; width: min(500px, 90vw); max-height: 400px; display: flex; flex-direction: column; box-shadow: 0 16px 48px rgba(0,0,0,0.2); overflow: hidden; }
	.palette-input { padding: 0.8em 1em; border: none; border-bottom: 1px solid var(--border); background: transparent; font-size: 1em; color: var(--text); outline: none; }
	.palette-input::placeholder { color: var(--text-muted); }
	.palette-list { list-style: none; margin: 0; padding: 0.3em; overflow-y: auto; flex: 1; }
	.palette-list li button { display: flex; align-items: center; gap: 0.6em; width: 100%; padding: 0.5em 0.7em; background: none; border: none; border-radius: 6px; cursor: pointer; color: var(--text); font-size: 0.9em; text-align: left; }
	.palette-list li.selected button { background: var(--code-bg); }
	.palette-list li button:hover { background: var(--code-bg); }
	.item-type { font-size: 0.65em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.15em 0.4em; border-radius: 4px; background: var(--code-bg); color: var(--text-muted); min-width: 2.5em; text-align: center; }
	.item-type.action-type { background: var(--success-bg); color: var(--success); }
	.status-msg { color: var(--success); font-weight: 500; }
	.item-name { font-weight: 500; flex: 1; }
	.item-path { font-size: 0.78em; color: var(--text-muted); font-family: monospace; }
	.empty { padding: 1em; text-align: center; color: var(--text-muted); font-size: 0.85em; }
	.palette-footer { padding: 0.4em 0.8em; border-top: 1px solid var(--border); font-size: 0.72em; color: var(--text-muted); display: flex; gap: 0.8em; align-items: center; }
	kbd { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-family: monospace; font-size: 0.9em; border: 1px solid var(--border); }
</style>

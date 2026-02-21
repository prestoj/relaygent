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
		if (!q) return pages;
		const matched = pages.filter(p =>
			p.name.toLowerCase().includes(q) || p.keys.some(k => k.includes(q))
		);
		return [...matched, ...kbResults];
	});

	$effect(() => { selectedIdx = 0; });
	$effect(() => {
		if (open && inputEl) setTimeout(() => inputEl?.focus(), 10);
	});

	function show() { open = true; query = ''; kbResults = []; selectedIdx = 0; }
	function hide() { open = false; }

	function handleKeydown(e) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open ? hide() : show(); return; }
		if (!open) return;
		if (e.key === 'Escape') { hide(); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, results.length - 1); }
		if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); }
		if (e.key === 'Enter' && results[selectedIdx]) { navigate(results[selectedIdx]); }
	}

	function navigate(item) { hide(); goto(item.path); }

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
			placeholder="Search pages, KB topics..." class="palette-input" />
		<ul class="palette-list">
			{#each results as item, i}
				<li class:selected={i === selectedIdx}>
					<button onclick={() => navigate(item)} onmouseenter={() => selectedIdx = i}>
						<span class="item-type">{item.type === 'kb' ? 'KB' : 'Page'}</span>
						<span class="item-name">{item.name}</span>
						<span class="item-path">{item.path}</span>
					</button>
				</li>
			{/each}
			{#if results.length === 0}
				<li class="empty">No results</li>
			{/if}
		</ul>
		<div class="palette-footer">
			<kbd>↑↓</kbd> navigate <kbd>↵</kbd> open <kbd>esc</kbd> close
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
	.item-name { font-weight: 500; flex: 1; }
	.item-path { font-size: 0.78em; color: var(--text-muted); font-family: monospace; }
	.empty { padding: 1em; text-align: center; color: var(--text-muted); font-size: 0.85em; }
	.palette-footer { padding: 0.4em 0.8em; border-top: 1px solid var(--border); font-size: 0.72em; color: var(--text-muted); display: flex; gap: 0.8em; align-items: center; }
	kbd { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-family: monospace; font-size: 0.9em; border: 1px solid var(--border); }
</style>

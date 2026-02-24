<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { initAudio, playChime, notifyDesktop } from './chatAudio.js';
	import { renderMsg, fmtTime, isRelayMsg, groupMessages } from './chatUtils.js';

	let { fullPage = false } = $props();
	let messages = $state([]);
	let input = $state('');
	let sending = $state(false);
	let hasMore = $state(true);
	let loadingOlder = $state(false);
	let ws = null;
	let chatEl = $state(null);
	let textareaEl = $state(null);
	let autoScroll = true;
	let expandedGroups = $state(new Set());
	let groups = $derived(groupMessages(messages));

	function toggleGroup(i) {
		const next = new Set(expandedGroups);
		next.has(i) ? next.delete(i) : next.add(i);
		expandedGroups = next;
	}

	async function loadHistory() {
		try {
			const res = await fetch('/api/chat?limit=50');
			const data = await res.json();
			messages = (data.messages || []).reverse();
			hasMore = data.messages?.length === 50;
			await tick(); scrollBottom();
		} catch {}
	}

	async function loadOlder() {
		if (loadingOlder || !hasMore || !messages.length) return;
		loadingOlder = true;
		const prev = chatEl?.scrollHeight || 0;
		try {
			const res = await fetch(`/api/chat?limit=50&before=${messages[0].id}`);
			const data = await res.json();
			const older = (data.messages || []).reverse();
			if (older.length < 50) hasMore = false;
			if (older.length) { messages = [...older, ...messages]; await tick(); if (chatEl) chatEl.scrollTop = chatEl.scrollHeight - prev; }
		} catch {}
		loadingOlder = false;
	}

	function onScroll() {
		if (chatEl?.scrollTop < 80) loadOlder();
		if (chatEl) autoScroll = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 60;
	}

	function connect() {
		if (!browser) return;
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onmessage = async (e) => {
			let msg; try { msg = JSON.parse(e.data); } catch { return; }
			if (msg.type !== 'message') return;
			messages = [...messages, msg.data];
			if (msg.data.role === 'assistant' && !isRelayMsg(msg.data)) { playChime(); notifyDesktop(msg.data.content); }
			await tick();
			if (autoScroll || msg.data.role === 'assistant') scrollBottom();
		};
		ws.onclose = () => setTimeout(connect, 3000);
	}

	function scrollBottom() { if (chatEl) chatEl.scrollTop = chatEl.scrollHeight; }

	async function send() {
		const text = input.trim();
		if (!text || sending) return;
		sending = true; input = '';
		if (textareaEl) textareaEl.style.height = 'auto';
		try { await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, role: 'human' }) }); } catch {}
		sending = false;
	}

	function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
	function resize(e) { const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }

	onMount(() => { if (browser) { document.addEventListener('click', initAudio); loadHistory(); connect(); } });
	onDestroy(() => { if (ws) ws.close(); if (browser) document.removeEventListener('click', initAudio); });
</script>

<section class="cp" class:full={fullPage}>
	{#if !fullPage}<div class="cp-header">Chat</div>{/if}
	<div class="cp-msgs" bind:this={chatEl} onscroll={onScroll}>
		{#if loadingOlder}<div class="cp-loading">Loading...</div>{/if}
		{#each groups as g, i}
			{#if g.relay}
				{#if g.msgs.length === 1 || expandedGroups.has(i)}
					{#each g.msgs as m}
						<div class="cp-msg bot relay"><div class="cp-bub"><span class="cp-text">{@html renderMsg(m)}</span></div><span class="cp-time">{fmtTime(m.created_at)}</span></div>
					{/each}
					{#if g.msgs.length > 1}<button class="cp-relay-btn" onclick={() => toggleGroup(i)}>hide {g.msgs.length} system messages</button>{/if}
				{:else}
					<button class="cp-relay-btn" onclick={() => toggleGroup(i)}>{g.msgs.length} system messages</button>
				{/if}
			{:else}
				<div class="cp-msg" class:human={g.msg.role==='human'} class:bot={g.msg.role==='assistant'}>
					<div class="cp-bub"><span class="cp-text">{@html renderMsg(g.msg)}</span></div><span class="cp-time">{fmtTime(g.msg.created_at)}</span>
				</div>
			{/if}
		{:else}<div class="cp-empty">No messages yet. Say hello!</div>{/each}
	</div>
	<div class="cp-inp">
		<textarea bind:this={textareaEl} bind:value={input} onkeydown={onKey} oninput={resize} placeholder="Message the agent..." rows="1" disabled={sending}></textarea>
		<button onclick={send} disabled={sending||!input.trim()} aria-label="Send">
			<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
		</button>
	</div>
</section>

<style>
	.cp { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; min-height: 350px; max-height: 60vh; margin-bottom: 1em; }
	.cp.full { border: none; border-radius: 0; background: var(--bg); min-height: 0; max-height: none; height: 100%; margin: 0 auto; max-width: 800px; width: 100%; padding: 0 1em; }
	.cp-header { font-weight: 700; font-size: 0.85em; padding: 0.5em 0.8em; border-bottom: 1px solid var(--border); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
	.cp-msgs { flex: 1; overflow-y: auto; padding: 0.5em 0.8em; display: flex; flex-direction: column; gap: 0.4em; }
	.cp-loading { text-align: center; color: var(--text-muted); font-size: 0.8em; padding: 0.5em; }
	.cp-empty { text-align: center; color: var(--text-muted); padding: 2em; font-size: 0.9em; }
	.cp-msg { display: flex; flex-direction: column; }
	.cp-msg.human { align-items: flex-end; }
	.cp-msg.bot { align-items: flex-start; }
	.cp-bub { max-width: 80%; padding: 0.5em 0.75em; border-radius: 12px; font-size: 0.88em; line-height: 1.5; word-break: break-word; }
	.cp-msg.human .cp-bub { background: var(--link); color: white; border-bottom-right-radius: 4px; }
	.cp-msg.bot .cp-bub { background: var(--code-bg); color: var(--text); border-bottom-left-radius: 4px; }
	.cp-msg.relay .cp-bub { opacity: 0.5; font-size: 0.8em; }
	.cp-text :global(p) { margin: 0.2em 0; } .cp-text :global(p:first-child) { margin-top: 0; } .cp-text :global(p:last-child) { margin-bottom: 0; }
	.cp-text :global(code) { background: rgba(0,0,0,0.1); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
	.cp-text :global(pre) { background: rgba(0,0,0,0.1); padding: 0.5em; border-radius: 4px; overflow-x: auto; margin: 0.3em 0; }
	.cp-time { font-size: 0.65em; color: var(--text-muted); margin-top: 0.15em; opacity: 0.7; padding: 0 0.2em; }
	.cp-relay-btn { background: none; border: 1px dashed var(--border); color: var(--text-muted); font-size: 0.75em; padding: 0.2em 0.6em; border-radius: 4px; cursor: pointer; align-self: center; }
	.cp-relay-btn:hover { color: var(--text); border-color: var(--text-muted); }
	.cp-inp { display: flex; gap: 0.5em; padding: 0.5em 0.8em; border-top: 1px solid var(--border); align-items: flex-end; }
	.cp-inp textarea { flex: 1; resize: none; border: 1px solid var(--border); border-radius: 8px; padding: 0.5em 0.75em; font-size: 0.88em; font-family: inherit; background: var(--bg); color: var(--text); outline: none; }
	.cp-inp textarea:focus { border-color: var(--link); }
	.cp-inp button { background: var(--link); color: white; border: none; border-radius: 8px; padding: 0.5em 0.6em; cursor: pointer; display: flex; align-items: center; }
	.cp-inp button:disabled { opacity: 0.4; cursor: default; }
	.cp-inp button:hover:not(:disabled) { opacity: 0.85; }
</style>

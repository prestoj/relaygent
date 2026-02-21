<script>
	import { onMount, onDestroy } from 'svelte';
	let notifications = $state([]);
	let loading = $state(true);
	let error = $state('');
	let collapsed = $state(false);
	let interval;

	async function fetchNotifications() {
		try {
			const d = await (await fetch('/api/notifications/pending?fast=1')).json();
			notifications = d.notifications || [];
			error = d.error || '';
		} catch { error = 'Notifications service unreachable'; }
		loading = false;
	}

	onMount(() => { fetchNotifications(); interval = setInterval(fetchNotifications, 30000); });
	onDestroy(() => clearInterval(interval));

	function fmtRelative(iso) {
		if (!iso) return '';
		try {
			const ms = Date.now() - new Date(iso).getTime();
			const min = Math.round(ms / 60000);
			if (min < 2) return 'just now';
			if (min < 60) return `${min}m ago`;
			const h = Math.round(min / 60);
			if (h < 24) return `${h}h ago`;
			return `${Math.round(h / 24)}d ago`;
		} catch { return ''; }
	}

	const sourceIcons = { slack: '#', github: 'GH', linear: 'LN', email: '@', reminder: '!', task: 'T', chat: '>' };
	function icon(src) { return sourceIcons[src] || '?'; }
</script>

{#if !loading && (notifications.length > 0 || error)}
<section class="notif-widget">
	<button class="notif-hdr" onclick={() => collapsed = !collapsed}>
		<span class="notif-title">Notifications</span>
		{#if notifications.length > 0}
			<span class="notif-count">{notifications.length}</span>
		{:else if error}
			<span class="notif-count notif-err-badge">!</span>
		{/if}
		<span class="notif-chev">{collapsed ? '\u25B6' : '\u25BC'}</span>
	</button>
	{#if !collapsed}
	<div class="notif-list">
		{#if error && notifications.length === 0}
			<div class="notif-err">{error}</div>
		{/if}
		{#each notifications as n}
		<div class="notif-row">
			<span class="notif-icon {n.source}">{icon(n.source)}</span>
			<span class="notif-text">{n.summary}</span>
			{#if n.time}<span class="notif-time">{fmtRelative(n.time)}</span>{/if}
		</div>
		{/each}
		<a href="/notifications" class="notif-history">View history</a>
	</div>
	{/if}
</section>
{/if}

<style>
	.notif-widget { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 0.8em; margin-bottom: 1em; }
	.notif-hdr { display: flex; align-items: center; gap: 0.5em; width: 100%; background: none; border: none; cursor: pointer; padding: 0; color: var(--text); }
	.notif-title { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
	.notif-count { font-size: 0.68em; font-weight: 700; background: var(--link); color: #fff; border-radius: 8px; padding: 0.05em 0.45em; min-width: 1.2em; text-align: center; }
	.notif-chev { font-size: 0.6em; color: var(--text-muted); margin-left: auto; }
	.notif-list { margin-top: 0.4em; display: flex; flex-direction: column; gap: 0.3em; }
	.notif-row { display: flex; align-items: center; gap: 0.5em; padding: 0.25em 0; font-size: 0.85em; }
	.notif-icon { font-size: 0.72em; font-weight: 700; font-family: monospace; min-width: 1.8em; text-align: center; padding: 0.1em 0.25em; border-radius: 4px; background: var(--code-bg); color: var(--text-muted); }
	.notif-icon.slack { background: #4a154b20; color: #4a154b; }
	.notif-icon.github { background: #24292e18; color: #24292e; }
	.notif-icon.linear { background: #5e6ad218; color: #5e6ad2; }
	.notif-icon.email { background: #ea433518; color: #ea4335; }
	.notif-icon.reminder { background: #fbbc0418; color: #f59e0b; }
	.notif-icon.task { background: #10b98118; color: #10b981; }
	.notif-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
	.notif-time { font-size: 0.72em; color: var(--text-muted); white-space: nowrap; }
	.notif-history { font-size: 0.75em; color: var(--text-muted); text-align: right; display: block; margin-top: 0.2em; }
	.notif-history:hover { color: var(--link); }
	.notif-err-badge { background: #ef4444; }
	.notif-err { font-size: 0.8em; color: #ef4444; padding: 0.2em 0; }
</style>

<script>
	import '../app.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import ChatBubble from '$lib/components/ChatBubble.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	let { children, data } = $props();
	let darkMode = $state(false);
	let menuOpen = $state(false);
	let dueTasks = $state(data.dueTasks || 0);
	let deadKbLinks = $derived(data.deadKbLinks || 0);
	// Sync dueTasks when layout data changes (e.g. navigation)
	$effect(() => { dueTasks = data.dueTasks || 0; });

	// Initialize darkMode from localStorage, then keep body class in sync
	if (browser) {
		const stored = localStorage.getItem('darkMode');
		darkMode = stored !== null ? stored === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches;
	}
	$effect(() => { if (browser) document.body.classList.toggle('dark-mode', darkMode); });

	function toggleDark() {
		darkMode = !darkMode;
		if (browser) {
			localStorage.setItem('darkMode', darkMode);
			document.body.classList.toggle('dark-mode', darkMode);
		}
	}

	function closeMenu() { menuOpen = false; }
	function isActive(href) { return $page.url.pathname === href || (href !== '/' && $page.url.pathname.startsWith(href)); }
	let pageName = $derived({kb:'KB',tasks:'Tasks',sessions:'Sessions',logs:'Logs',files:'Files',search:'Search',settings:'Settings',intent:'Intent',help:'Help',changelog:'Changelog'}[$page.url.pathname.split('/')[1]] || '');

</script>

<svelte:head><title>{pageName ? `Relaygent · ${pageName}` : 'Relaygent'}</title><link rel="icon" href="/favicon.svg" /></svelte:head>

<div class="app-wrapper" class:dark={darkMode}>
<nav>
	<a href="/" class="brand">Relaygent</a>
	<button class="hamburger" onclick={() => menuOpen = !menuOpen} aria-label="Toggle menu">
		<span class="bar" class:open={menuOpen}></span>
		<span class="bar" class:open={menuOpen}></span>
		<span class="bar" class:open={menuOpen}></span>
	</button>
	<div class="links" class:open={menuOpen}>
		<a href="/" class:active={$page.url.pathname === '/'} onclick={closeMenu}>Dashboard</a>
		<a href="/intent" class:active={isActive('/intent')} onclick={closeMenu}>Intent</a>
		<a href="/kb" class:active={isActive('/kb')} onclick={closeMenu}>KB{#if deadKbLinks > 0}<span class="unread-badge">{deadKbLinks}</span>{/if}</a>
		<a href="/tasks" class:active={isActive('/tasks')} onclick={() => { dueTasks = 0; closeMenu(); }}>
			Tasks{#if dueTasks > 0}<span class="unread-badge">{dueTasks}</span>{/if}
		</a>
		<a href="/sessions" class:active={isActive('/sessions')} onclick={closeMenu}>Sessions</a>
		<a href="/logs" class:active={isActive('/logs')} onclick={closeMenu}>Logs</a>
		<a href="/files" class:active={isActive('/files')} onclick={closeMenu}>Files</a>
		<a href="/search" class:active={isActive('/search')} onclick={closeMenu}>Search</a>
		<a href="/settings" class:active={isActive('/settings')} onclick={closeMenu}>Settings</a>
		<a href="/help" class:active={isActive('/help')} onclick={closeMenu}>Help</a>
		<button class="theme-toggle" onclick={toggleDark} aria-label="Toggle dark mode" title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
			{darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19'}
		</button>
		{#if data.authEnabled}<form method="POST" action="/api/auth" style="margin:0;display:inline"><button class="logout-btn" type="submit">Logout</button></form>{/if}
	</div>
</nav>

<main>
	{@render children()}
</main>
<ChatBubble />
<CommandPalette />
</div>

<style>
	nav {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.75em 1.5em; background: var(--bg-surface);
		border-bottom: 1px solid var(--border); position: relative;
	}
	.brand { font-weight: 700; font-size: 1.1em; color: var(--text); }
	.links { display: flex; gap: 1.25em; align-items: center; }
	.links a.active { color: var(--text); font-weight: 600; border-bottom: 2px solid var(--link); padding-bottom: 0.1em; text-decoration: none; }
	.hamburger { display: none; }
	.unread-badge { display: inline-block; background: var(--error); color: white; font-size: 0.65em; font-weight: 700; padding: 0.1em 0.35em; border-radius: 8px; margin-left: 0.3em; vertical-align: middle; line-height: 1.4; }

	.theme-toggle {
		background: none; border: none; cursor: pointer;
		font-size: 1.15em; padding: 0.15em 0.3em; border-radius: 4px; line-height: 1;
		transition: transform 0.2s;
	}
	.theme-toggle:hover { transform: scale(1.2); }
	.notif-bell { font-size: 1.1em; line-height: 1; text-decoration: none !important; display: inline-flex; align-items: center; }
	.notif-bell:hover { transform: scale(1.15); }
	.logout-btn {
		background: none; border: 1px solid var(--border); cursor: pointer;
		font-size: 0.85em; padding: 0.25em 0.5em; border-radius: 4px; color: var(--text-muted);
	}
	.logout-btn:hover { color: var(--text); }

	main { max-width: 900px; margin: 2em auto; padding: 0 1.5em; }

	@media (max-width: 800px) {
		nav { padding: 0.5em 1em; }
		.hamburger {
			display: flex; flex-direction: column; gap: 4px;
			background: none; border: none; cursor: pointer; padding: 0.4em; z-index: 101;
		}
		.bar {
			display: block; width: 20px; height: 2px; background: var(--text);
			border-radius: 1px; transition: transform 0.2s, opacity 0.2s;
		}
		.bar.open:nth-child(1) { transform: rotate(45deg) translate(4px, 4px); }
		.bar.open:nth-child(2) { opacity: 0; }
		.bar.open:nth-child(3) { transform: rotate(-45deg) translate(4px, -4px); }
		.links {
			display: none; flex-direction: column; gap: 0;
			position: absolute; top: 100%; left: 0; right: 0;
			background: var(--bg-surface); border-bottom: 1px solid var(--border);
			padding: 0.5em 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
		}
		.links.open { display: flex; }
		.links a {
			padding: 0.6em 1.5em; width: 100%; box-sizing: border-box;
			color: var(--text); font-size: 0.95em;
		}
		.links a:hover { background: var(--code-bg); text-decoration: none; }
		.links a.active { background: var(--code-bg); border-bottom: none; border-left: 3px solid var(--link); font-weight: 600; }
		.theme-toggle { padding: 0.6em 1.5em; text-align: center; border: none; }
		.logout-btn { padding: 0.6em 1.5em; text-align: left; border: none; }
		main { margin: 1em auto; padding: 0 1em; }
	}
</style>

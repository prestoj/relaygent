<script>
	import { browser } from '$app/environment';
	import { initTheme, isDark } from '$lib/theme.svelte.js';
	let { children } = $props();
	initTheme();
	let dark = $derived(isDark());
	$effect(() => { if (browser) document.body.classList.toggle('dark-mode', dark); });
</script>

<div class="login-wrapper" class:dark>
	{@render children()}
</div>

<style>
	.login-wrapper {
		--bg: #fafafa; --bg-surface: #fff; --text: #1a1a1a; --text-muted: #555;
		--link: #2563eb; --border: #e5e5e5; --code-bg: #f0f0f0;
		background: var(--bg); color: var(--text); min-height: 100vh;
		display: flex; align-items: center; justify-content: center;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	.login-wrapper.dark {
		--bg: #0d1117; --bg-surface: #161b22; --text: #e6edf3; --text-muted: #8b949e;
		--link: #58a6ff; --border: #30363d; --code-bg: #21262d;
	}
</style>

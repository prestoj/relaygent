<script>
	import { page } from '$app/stores';
</script>

<svelte:head><title>{$page.status} | Relaygent</title></svelte:head>

<section class="error-page">
	<div class="code">{$page.status}</div>
	<h1>{$page.error?.message || 'Something went wrong'}</h1>

	{#if $page.status === 404}
		<p>This page doesn't exist. It may have been moved or removed.</p>
	{:else if $page.status >= 500}
		<p>The hub encountered an internal error. This usually means a service is down or the build is stale.</p>
		<div class="hint">
			<code>relaygent check</code> to diagnose
			<br><code>relaygent update</code> to rebuild and restart
		</div>
	{:else}
		<p>An unexpected error occurred.</p>
	{/if}

	<div class="actions">
		<a href="/">Back to Dashboard</a>
	</div>
</section>

<style>
	.error-page { text-align: center; padding: 4em 1em; }
	.code { font-size: 4em; font-weight: 800; color: var(--text-muted); opacity: 0.3; line-height: 1; }
	h1 { font-size: 1.3em; margin: 0.5em 0; color: var(--text); }
	p { color: var(--text-muted); margin: 0.5em 0 1.5em; font-size: 0.95em; }
	.hint { background: var(--code-bg); border-radius: 8px; padding: 1em; display: inline-block; text-align: left; margin-bottom: 1.5em; font-size: 0.9em; line-height: 2; }
	.actions a { display: inline-block; padding: 0.5em 1.2em; border: 1px solid var(--border); border-radius: 6px; color: var(--link); font-weight: 600; font-size: 0.9em; }
	.actions a:hover { background: var(--code-bg); text-decoration: none; }
</style>

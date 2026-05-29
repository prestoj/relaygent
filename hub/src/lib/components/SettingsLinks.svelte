<script>
	// Quick links to pages reached via Settings (moved out of the top nav).
	const links = [
		{ href: '/intent', label: 'Intent', desc: "Preston's current priorities & direction" },
		{ href: '/sessions', label: 'Sessions', desc: 'Past relay sessions & stats' },
		{ href: '/secrets', label: 'Secrets', desc: 'Share secrets with Claude (encrypted)' },
		{ href: '/help', label: 'Help', desc: 'Hub features & shortcuts' },
	];
</script>

<section class="card">
	<h2>Pages</h2>
	<div class="links">
		{#each links as l (l.href)}
			<a class="link" href={l.href}>
				<span class="link-label">{l.label}</span>
				<span class="link-desc">{l.desc}</span>
			</a>
		{/each}
	</div>
</section>

<style>
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1em; }
	.links { display: grid; grid-template-columns: repeat(auto-fill, minmax(13em, 1fr)); gap: 0.6em; }
	.link { display: flex; flex-direction: column; gap: 0.15em; padding: 0.6em 0.8em; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; text-decoration: none; transition: border-color 0.12s; }
	.link:hover { border-color: var(--link); }
	.link-label { font-weight: 600; color: var(--text); font-size: 0.92em; }
	.link-desc { font-size: 0.78em; color: var(--text-muted); }
</style>

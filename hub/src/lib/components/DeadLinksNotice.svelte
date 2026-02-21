<script>
	let { deadLinks = [] } = $props();
	let showDeadLinks = $state(false);
</script>

{#if deadLinks.length > 0}
	<div class="dead-links-notice">
		<button class="dead-links-toggle" onclick={() => showDeadLinks = !showDeadLinks}>
			{deadLinks.length} broken wiki-link{deadLinks.length !== 1 ? 's' : ''}
			{showDeadLinks ? '\u25B2' : '\u25BC'}
		</button>
		{#if showDeadLinks}
			<ul class="dead-links-list">
				{#each deadLinks as link}
					<li>
						<a href="/kb/{link.source}">{link.source}</a>
						&rarr; <code>[[{link.display}]]</code> (missing: <em>{link.target}</em>)
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.dead-links-notice { margin: 0.5em 0; }
	.dead-links-toggle {
		background: none; border: none; cursor: pointer;
		font-size: 0.85em; padding: 0.25em 0;
		color: var(--warning, #b45309);
	}
	.dead-links-list {
		list-style: none; padding: 0.25em 0 0 0;
		font-size: 0.85em; color: var(--text-muted);
	}
	.dead-links-list li { padding: 0.2em 0; }
	.dead-links-list code { background: var(--code-bg); border-radius: 3px; padding: 0.1em 0.3em; }
</style>

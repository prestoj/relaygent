<script>
	let { pct } = $props();
</script>

{#if pct != null}
	<div class="context-bar">
		<div class="context-label">Context <span class="context-value" class:warn={pct >= 60} class:crit={pct >= 85}>{pct}%</span></div>
		<div class="context-track">
			<div class="context-fill" class:warn={pct >= 60} class:crit={pct >= 85} style="width: {pct}%"></div>
		</div>
	</div>
{/if}

<style>
	.context-bar { margin-bottom: 1em; }
	.context-label { font-size: 0.75em; color: var(--text-muted); margin-bottom: 0.3em; display: flex; align-items: center; gap: 0.4em; }
	.context-value { font-weight: 600; font-family: monospace; color: var(--success); }
	.context-value.warn { color: var(--warning); }
	.context-value.crit { color: var(--error); }
	.context-track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
	.context-fill { height: 100%; background: var(--success); border-radius: 3px; transition: width 0.5s ease; }
	.context-fill.warn { background: var(--warning); }
	.context-fill.crit { background: var(--error); }
</style>

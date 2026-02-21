<script>
	let running = $state('');
	let output = $state('');
	let failed = $state(false);
	let collapsed = $state(true);

	const actions = [
		{ id: 'health', label: 'Health' },
		{ id: 'check', label: 'Diagnostics' },
		{ id: 'status', label: 'Status' },
		{ id: 'digest', label: 'Digest' },
		{ id: 'changelog', label: 'Changelog' },
		{ id: 'clean-logs', label: 'Clean Logs (dry)' },
	];

	async function run(id) {
		running = id; output = ''; failed = false; collapsed = false;
		try {
			const res = await fetch('/api/actions', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: id }),
			});
			const data = await res.json();
			output = data.output || data.error || 'No output';
			failed = !!data.exitCode;
		} catch (e) { output = e.message; failed = true; }
		running = '';
	}
</script>

<section class="qa">
	<button class="qa-hdr" onclick={() => collapsed = !collapsed}>
		<span class="qa-title">Quick Actions</span>
		<span class="qa-chev">{collapsed ? '\u25B6' : '\u25BC'}</span>
	</button>
	{#if !collapsed}
	<div class="qa-grid">
		{#each actions as a}
		<button class="qa-btn" disabled={!!running} onclick={() => run(a.id)}>
			{#if running === a.id}<span class="qa-spin">&#x21bb;</span>{:else}{a.label}{/if}
		</button>
		{/each}
	</div>
	{#if output}
	<div class="qa-output" class:err={failed}>
		<button class="qa-close" onclick={() => { output = ''; }}>x</button>
		<pre>{output}</pre>
	</div>
	{/if}
	{/if}
</section>

<style>
	.qa { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6em 0.8em; margin-bottom: 1em; }
	.qa-hdr { display: flex; align-items: center; gap: 0.5em; width: 100%; background: none; border: none; cursor: pointer; padding: 0; color: var(--text); }
	.qa-title { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
	.qa-chev { font-size: 0.6em; color: var(--text-muted); margin-left: auto; }
	.qa-grid { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.5em; }
	.qa-btn {
		font-size: 0.78em; padding: 0.35em 0.7em; border: 1px solid var(--border);
		border-radius: 6px; background: var(--bg); color: var(--text); cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}
	.qa-btn:hover:not(:disabled) { border-color: var(--link); color: var(--link); }
	.qa-btn:disabled { opacity: 0.5; cursor: wait; }
	.qa-spin { display: inline-block; animation: spin 1s linear infinite; }
	@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
	.qa-output { margin-top: 0.5em; position: relative; max-height: 300px; overflow: auto; background: var(--code-bg); border-radius: 6px; padding: 0.6em; }
	.qa-output pre { margin: 0; font-size: 0.78em; white-space: pre-wrap; word-break: break-word; color: var(--text); }
	.qa-output.err pre { color: var(--error, #ef4444); }
	.qa-close { position: absolute; top: 0.3em; right: 0.5em; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85em; }
	.qa-close:hover { color: var(--text); }
</style>

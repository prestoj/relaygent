<script>
	let { hasIntent = false, onStart } = $props();
</script>

<div class="waiting-icon">&#128075;</div>
<div class="waiting-text">Welcome to Relaygent</div>
<div class="waiting-hint">Get started in three steps:</div>

<div class="steps">
	<div class="step" class:done={hasIntent}>
		<span class="step-num">{hasIntent ? '\u2713' : '1'}</span>
		<div class="step-body">
			{#if hasIntent}
				<span class="step-label">Intent set</span>
			{:else}
				<a href="/intent" class="step-label step-link">Set your Intent</a>
				<span class="step-desc">Tell the agent what to focus on — priorities, goals, and direction</span>
			{/if}
		</div>
	</div>

	<div class="step" class:waiting={!hasIntent}>
		<span class="step-num">2</span>
		<div class="step-body">
			{#if hasIntent}
				<button class="step-label step-btn" onclick={onStart}>Start the agent</button>
				<span class="step-desc">Launch the relay loop — the agent will read your Intent and begin working</span>
			{:else}
				<span class="step-label">Start the agent</span>
				<span class="step-desc">Set your Intent first, then launch the relay</span>
			{/if}
		</div>
	</div>

	<div class="step" class:waiting={true}>
		<span class="step-num">3</span>
		<div class="step-body">
			<span class="step-label">Chat with your agent</span>
			<span class="step-desc">Send messages, ask questions, and watch progress on the dashboard</span>
		</div>
	</div>
</div>

<div class="links">
	<a href="/help">Help</a>
	<span class="dot-sep"></span>
	<a href="/settings">Settings</a>
	<span class="dot-sep"></span>
	<a href="/kb">Knowledge Base</a>
</div>

<style>
	.waiting-icon { font-size: 2em; margin-bottom: 0.5em; }
	.waiting-text { font-size: 1.1em; font-weight: 600; color: var(--text); margin-bottom: 0.3em; }
	.waiting-hint { font-size: 0.85em; color: var(--text-muted); margin-bottom: 1.5em; }
	.steps { display: flex; flex-direction: column; gap: 0.75em; text-align: left; max-width: 420px; margin: 0 auto 1.5em; }
	.step { display: flex; gap: 0.75em; align-items: flex-start; padding: 0.6em 0.8em; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); transition: border-color 0.15s; }
	.step.done { border-color: var(--success); background: color-mix(in srgb, var(--success) 6%, var(--bg)); }
	.step.waiting { opacity: 0.55; }
	.step:not(.done):not(.waiting) { border-color: var(--link); background: color-mix(in srgb, var(--link) 6%, var(--bg)); }
	.step-num { display: flex; align-items: center; justify-content: center; width: 1.6em; height: 1.6em; border-radius: 50%; font-weight: 700; font-size: 0.8em; flex-shrink: 0; background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-muted); }
	.step.done .step-num { background: var(--success); color: white; border-color: var(--success); }
	.step:not(.done):not(.waiting) .step-num { background: var(--link); color: white; border-color: var(--link); }
	.step-body { display: flex; flex-direction: column; gap: 0.15em; min-width: 0; }
	.step-label { font-weight: 600; font-size: 0.88em; color: var(--text); }
	.step-link { color: var(--link); text-decoration: none; }
	.step-link:hover { text-decoration: underline; }
	.step-btn { background: var(--link); color: white; border: none; padding: 0.25em 0.8em; border-radius: 5px; cursor: pointer; font: inherit; font-weight: 600; font-size: 0.88em; }
	.step-btn:hover { opacity: 0.9; }
	.step-desc { font-size: 0.75em; color: var(--text-muted); line-height: 1.4; }
	.links { font-size: 0.8em; color: var(--text-muted); }
	.links a { color: var(--link); text-decoration: none; }
	.links a:hover { text-decoration: underline; }
	.dot-sep { margin: 0 0.4em; }
	.dot-sep::before { content: '\00B7'; }
</style>

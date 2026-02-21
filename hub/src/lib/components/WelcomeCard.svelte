<div class="waiting-icon">&#128075;</div>
<div class="waiting-text">Welcome to Relaygent</div>
<div class="waiting-hint">Your AI agent runs autonomously on this machine. Here's how to get started:</div>
<div class="onboard">
	<button class="ob-card" onclick={() => window.dispatchEvent(new CustomEvent('open-chat'))}>
		<span class="ob-icon">&#128172;</span>
		<span class="ob-label">Chat</span>
		<span class="ob-desc">Send messages to your agent</span>
	</button>
	<a href="/intent" class="ob-card">
		<span class="ob-icon">&#127919;</span>
		<span class="ob-label">Set Intent</span>
		<span class="ob-desc">Tell the agent what to work on</span>
	</a>
	<a href="/kb" class="ob-card">
		<span class="ob-icon">&#128218;</span>
		<span class="ob-label">Knowledge Base</span>
		<span class="ob-desc">Persistent memory across sessions</span>
	</a>
	<a href="/help" class="ob-card">
		<span class="ob-icon">&#10067;</span>
		<span class="ob-label">Help Guide</span>
		<span class="ob-desc">Concepts, shortcuts, CLI reference</span>
	</a>
</div>
<div class="start-hint">Click <strong>Start</strong> above to launch the agent, or run <code>relaygent start</code>. First time? Check <a href="/settings">Settings</a> for setup status.</div>

<style>
	.waiting-icon { font-size: 2em; margin-bottom: 0.5em; }
	.waiting-text { font-size: 1.1em; font-weight: 600; color: var(--text); margin-bottom: 0.3em; }
	.waiting-hint { font-size: 0.85em; color: var(--text-muted); margin-bottom: 1.5em; }
	.onboard { display: flex; gap: 1em; justify-content: center; flex-wrap: wrap; margin-bottom: 1.5em; }
	.ob-card { display: flex; flex-direction: column; align-items: center; gap: 0.3em; padding: 1em 1.2em; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; text-decoration: none; min-width: 140px; transition: border-color 0.15s, box-shadow 0.15s; cursor: pointer; font: inherit; }
	.ob-card:hover { border-color: var(--link); box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-decoration: none; }
	.ob-icon { font-size: 1.5em; }  .ob-label { font-weight: 600; color: var(--text); font-size: 0.9em; }  .ob-desc { color: var(--text-muted); font-size: 0.75em; }
	.start-hint { font-size: 0.8em; color: var(--text-muted); }
</style>

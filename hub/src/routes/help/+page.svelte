<svelte:head><title>Help — Relaygent</title></svelte:head>

<h1>Help</h1>

<section class="card">
	<h2>Quick Start</h2>
	<ol class="steps">
		<li><strong>Set your intent</strong> — Tell the agent what to focus on at <a href="/intent">Intent</a></li>
		<li><strong>Start the agent</strong> — Run <code>relaygent start</code> in your terminal</li>
		<li><strong>Watch it work</strong> — The <a href="/">Dashboard</a> shows real-time activity</li>
		<li><strong>Chat anytime</strong> — Click the chat bubble (bottom-right) or run <code>relaygent chat "message"</code></li>
	</ol>
</section>

<section class="card">
	<h2>Core Concepts</h2>
	<dl class="concepts">
		<dt>Intent</dt>
		<dd>Your priorities for the agent. Edit at <a href="/intent">/intent</a> — the agent reads this every session to stay aligned with your goals.</dd>
		<dt>Knowledge Base</dt>
		<dd>Persistent notes and documentation at <a href="/kb">/kb</a>. The agent reads and writes topics linked with [[wiki-links]]. Think of it as shared long-term memory.</dd>
		<dt>Context</dt>
		<dd>The agent's working memory for the current session. The percentage bar on the dashboard shows how full it is. At ~85%, the session hands off to a fresh one automatically.</dd>
		<dt>Sessions</dt>
		<dd>Each relay run is a session. Browse history at <a href="/sessions">/sessions</a> to see what the agent did, including tool calls and decisions.</dd>
		<dt>Tasks</dt>
		<dd>One-off or recurring reminders at <a href="/tasks">/tasks</a>. Due tasks wake the agent and appear as notifications.</dd>
		<dt>Handoff</dt>
		<dd>When a session ends, the agent writes a briefing for its successor. This ensures continuity across sessions — work picks up where it left off.</dd>
	</dl>
</section>

<section class="card">
	<h2>Hub Pages</h2>
	<div class="ref-grid">
		<div class="ref-key"><a href="/">Dashboard</a></div><div>Live activity feed, status, screen view, and quick actions</div>
		<div class="ref-key"><a href="/intent">Intent</a></div><div>Set and edit the agent's priorities and direction</div>
		<div class="ref-key"><a href="/kb">KB</a></div><div>Knowledge base with wiki-linked topics and search</div>
		<div class="ref-key"><a href="/tasks">Tasks</a></div><div>Create one-off or recurring reminders and todos</div>
		<div class="ref-key"><a href="/sessions">Sessions</a></div><div>Browse past session history with exportable logs</div>
		<div class="ref-key"><a href="/logs">Logs</a></div><div>Live system logs with search and syntax coloring</div>
		<div class="ref-key"><a href="/files">Files</a></div><div>Upload, download, and preview shared files</div>
		<div class="ref-key"><a href="/search">Search</a></div><div>Full-text search across KB topics and sessions</div>
		<div class="ref-key"><a href="/notifications">Notifications</a></div><div>History of alerts from Slack, email, GitHub, Linear</div>
		<div class="ref-key"><a href="/settings">Settings</a></div><div>System info, services, MCP servers, and setup status</div>
	</div>
</section>

<section class="card">
	<h2>Keyboard Shortcuts</h2>
	<div class="ref-grid">
		<div class="ref-key"><kbd>Cmd+K</kbd> or <kbd>?</kbd></div><div>Open command palette (search pages and KB)</div>
		<div class="ref-key"><kbd>Esc</kbd></div><div>Close dialogs, overlays, and the command palette</div>
		<div class="ref-key"><kbd>Up</kbd> / <kbd>Down</kbd></div><div>Navigate results in command palette</div>
		<div class="ref-key"><kbd>Enter</kbd></div><div>Open the selected result</div>
	</div>
</section>

<section class="card">
	<h2>CLI Quick Reference</h2>
	<div class="ref-grid cli">
		<div class="ref-key"><code>relaygent start</code></div><div>Start the relay agent</div>
		<div class="ref-key"><code>relaygent stop</code></div><div>Stop the relay agent</div>
		<div class="ref-key"><code>relaygent status</code></div><div>Show relay and service status</div>
		<div class="ref-key"><code>relaygent chat "msg"</code></div><div>Send a chat message from the terminal</div>
		<div class="ref-key"><code>relaygent chat --read</code></div><div>Read recent chat messages</div>
		<div class="ref-key"><code>relaygent check</code></div><div>Run system health checks</div>
		<div class="ref-key"><code>relaygent logs [service]</code></div><div>Tail service logs (fuzzy name matching)</div>
		<div class="ref-key"><code>relaygent open [page]</code></div><div>Open hub page in browser</div>
		<div class="ref-key"><code>relaygent setup</code></div><div>Run the initial setup wizard</div>
		<div class="ref-key"><code>relaygent update</code></div><div>Pull latest changes and rebuild</div>
		<div class="ref-key"><code>relaygent digest</code></div><div>Show daily activity summary</div>
		<div class="ref-key"><code>relaygent test [suite]</code></div><div>Run test suites</div>
		<div class="ref-key"><code>relaygent mcp list</code></div><div>List configured MCP servers</div>
	</div>
</section>

<section class="card">
	<h2>How It Works</h2>
	<p>Relaygent runs a Claude agent in a continuous relay loop. Each session works until its context fills, then writes a handoff and a fresh session takes over. The agent can:</p>
	<ul>
		<li>Read and write files, run commands, browse the web</li>
		<li>Use MCP tools (Slack, email, GitHub, Linear, screen control)</li>
		<li>Sleep and wake on notifications (Slack messages, emails, task reminders)</li>
		<li>Coordinate with other agents across machines</li>
	</ul>
	<p class="hint">Configure integrations in <a href="/settings">Settings</a> or via <code>relaygent mcp add</code></p>
</section>

<section class="card">
	<h2>Troubleshooting</h2>
	<dl class="concepts">
		<dt>Agent won't start</dt>
		<dd>Run <code>relaygent check</code> to diagnose. Common causes: Claude Code not authenticated (<code>claude /login</code>), missing config (<code>relaygent setup</code>), or no Intent set.</dd>
		<dt>Services are down</dt>
		<dd>Check <a href="/settings">Settings</a> for red dots. Use <code>relaygent restart</code> or the Restart button on the Settings page. Run <code>relaygent install-services</code> if auto-restart isn't set up.</dd>
		<dt>Agent seems stuck or confused</dt>
		<dd>Rewrite your <a href="/intent">Intent</a> with clearer instructions. The agent reads it fresh every session. You can also send a chat message with specific direction.</dd>
		<dt>Context fills too quickly</dt>
		<dd>This is normal — sessions automatically hand off to successors. The agent writes a briefing so work continues seamlessly. Check <a href="/sessions">Sessions</a> to see handoff history.</dd>
		<dt>Agent didn't do what I asked</dt>
		<dd>Send a chat message — the agent checks messages at session start. For persistent priorities, update your <a href="/intent">Intent</a>. For one-off requests, chat is best.</dd>
		<dt>Disk space is low</dt>
		<dd>Run <code>relaygent cleanup</code> to remove old sessions, caches, and logs. Use <code>--dry-run</code> first to see what would be removed.</dd>
		<dt>Hub shows a blank page or errors</dt>
		<dd>Run <code>relaygent update</code> to rebuild. If that fails, check <code>relaygent logs hub</code> for errors. The hub auto-rebuilds every 5 minutes if stale.</dd>
	</dl>
</section>

<style>
	h1 { margin-top: 0; }
	h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 0.75em; }
	.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1em 1.25em; margin-bottom: 1em; }
	.steps { margin: 0; padding-left: 1.5em; }
	.steps li { margin-bottom: 0.5em; font-size: 0.92em; line-height: 1.5; }
	.steps li:last-child { margin-bottom: 0; }
	.concepts { margin: 0; }
	.concepts dt { font-weight: 600; font-size: 0.92em; margin-top: 0.6em; }
	.concepts dt:first-child { margin-top: 0; }
	.concepts dd { margin: 0.15em 0 0 0; font-size: 0.88em; color: var(--text-muted); line-height: 1.5; }
	.ref-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.4em 1em; font-size: 0.9em; align-items: baseline; }
	.ref-key { font-weight: 500; white-space: nowrap; }
	.ref-grid.cli .ref-key { font-weight: 400; }
	kbd { background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 3px; font-family: monospace; font-size: 0.88em; border: 1px solid var(--border); }
	.hint { font-size: 0.82em; color: var(--text-muted); margin: 0.75em 0 0; }
	section p { font-size: 0.9em; line-height: 1.5; margin: 0 0 0.5em; }
	section ul { margin: 0; padding-left: 1.5em; font-size: 0.88em; }
	section ul li { margin-bottom: 0.3em; }
	@media (max-width: 600px) {
		.ref-grid { grid-template-columns: 1fr; gap: 0.1em 0; }
		.ref-key { margin-top: 0.5em; }
		.ref-grid > div:not(.ref-key) { color: var(--text-muted); font-size: 0.88em; }
	}
</style>

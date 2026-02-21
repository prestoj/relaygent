<script>
	let { data } = $props();
	let issues = $state(data.issues || []);
	let teams = $state(data.teams || []);
	let activeTeam = $state(data.activeTeamId || '');
	let loading = $state(false);
	let error = $state(data.error || '');
	let showForm = $state(false);
	let newTitle = $state('');
	let newDesc = $state('');

	const priorityLabels = ['None', 'Urgent', 'High', 'Medium', 'Low'];
	const stateIcons = { backlog: 'o', unstarted: '-', started: '>', completed: 'v', cancelled: 'x' };

	async function loadIssues(teamId) {
		activeTeam = teamId; loading = true; error = '';
		try {
			const res = await fetch(`/api/linear?teamId=${teamId}`);
			const d = await res.json();
			if (!res.ok) { error = d.error; return; }
			issues = d.issues || [];
		} catch { error = 'Failed to load issues'; }
		finally { loading = false; }
	}

	async function createNew() {
		if (!newTitle.trim() || !activeTeam) return;
		error = '';
		try {
			const res = await fetch('/api/linear', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ teamId: activeTeam, title: newTitle, description: newDesc }),
			});
			const d = await res.json();
			if (!res.ok) { error = d.error; return; }
			newTitle = ''; newDesc = ''; showForm = false;
			await loadIssues(activeTeam);
		} catch { error = 'Failed to create issue'; }
	}

	function stateIcon(type) { return stateIcons[type] || '?'; }
</script>

<svelte:head><title>Linear — Relaygent</title></svelte:head>

<h1>Linear Issues</h1>

{#if !data.configured}
	<div class="setup-notice">
		<p><strong>Linear not configured.</strong></p>
		<p>Create a personal API key at <a href="https://linear.app/settings/api" target="_blank">linear.app/settings/api</a> and save it to:</p>
		<code>~/.relaygent/linear/api-key</code>
	</div>
{:else}
	{#if teams.length > 1}
		<div class="team-bar">
			{#each teams as t}
				<button class:active={t.id === activeTeam} onclick={() => loadIssues(t.id)}>{t.key} — {t.name}</button>
			{/each}
		</div>
	{/if}

	<div class="toolbar">
		<span class="count">{issues.length} issue{issues.length !== 1 ? 's' : ''}</span>
		<button class="new-btn" onclick={() => showForm = !showForm}>{showForm ? 'Cancel' : '+ New Issue'}</button>
	</div>

	{#if showForm}
		<div class="new-form">
			<input bind:value={newTitle} placeholder="Issue title" class="form-input" />
			<textarea bind:value={newDesc} placeholder="Description (optional)" rows="3" class="form-input"></textarea>
			<button onclick={createNew} disabled={!newTitle.trim()}>Create</button>
		</div>
	{/if}

	{#if error}<p class="err">{error}</p>{/if}
	{#if loading}<p class="muted">Loading...</p>{/if}

	{#if issues.length === 0 && !loading}
		<p class="muted">No issues found.</p>
	{:else}
		<div class="issue-list">
			{#each issues as issue}
				<div class="issue-row">
					<span class="state-icon" title={issue.state?.name} style="color: {issue.state?.color || 'inherit'}">{stateIcon(issue.state?.type)}</span>
					<span class="ident">{issue.identifier}</span>
					<span class="title">{issue.title}</span>
					<span class="priority p{issue.priority}">{priorityLabels[issue.priority] || ''}</span>
					{#if issue.assignee}<span class="assignee">{issue.assignee.name}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}

<style>
	h1 { margin-top: 0; }
	.setup-notice { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5em; text-align: center; }
	.setup-notice code { display: block; margin-top: 0.5em; font-size: 0.95em; }
	.team-bar { display: flex; gap: 0.5em; margin-bottom: 1em; }
	.team-bar button { padding: 0.3em 0.7em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-size: 0.85em; }
	.team-bar button.active { border-color: var(--link); color: var(--link); font-weight: 600; }
	.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75em; }
	.count { font-size: 0.85em; color: var(--text-muted); }
	.new-btn { padding: 0.3em 0.7em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.85em; color: var(--text); }
	.new-btn:hover { border-color: var(--link); color: var(--link); }
	.new-form { display: flex; flex-direction: column; gap: 0.5em; margin-bottom: 1em; }
	.form-input { padding: 0.5em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text); font-size: 0.9em; font-family: inherit; }
	.new-form button { align-self: flex-start; padding: 0.4em 1em; border: none; border-radius: 6px; background: var(--link); color: white; cursor: pointer; font-size: 0.85em; }
	.new-form button:disabled { opacity: 0.5; cursor: default; }
	.err { color: #dc2626; font-size: 0.85em; }
	.muted { color: var(--text-muted); font-style: italic; }
	.issue-list { display: flex; flex-direction: column; gap: 2px; }
	.issue-row { display: flex; align-items: center; gap: 0.6em; padding: 0.5em 0.75em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.9em; }
	.state-icon { font-family: monospace; font-weight: 700; width: 1.2em; text-align: center; }
	.ident { color: var(--text-muted); font-size: 0.85em; white-space: nowrap; }
	.title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.priority { font-size: 0.75em; padding: 0.1em 0.4em; border-radius: 4px; white-space: nowrap; }
	.p1 { background: #dc2626; color: white; }
	.p2 { background: #f97316; color: white; }
	.p3 { background: #eab308; color: #1a1a1a; }
	.p4 { color: var(--text-muted); }
	.assignee { font-size: 0.8em; color: var(--text-muted); white-space: nowrap; }
</style>

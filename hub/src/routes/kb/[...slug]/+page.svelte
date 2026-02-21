<script>
	import { marked } from 'marked';
	import { sanitizeHtml } from '$lib/sanitize.js';
	let { data, form } = $props();
	let editing = $state(false);
	let editContent = $state('');
	let newTitle = $state(data.slug || '');
	let confirmDelete = $state(false);
	let previewMode = $state(false);
	let previewHtml = $derived(previewMode ? sanitizeHtml(marked.parse(editContent || '')) : '');

	function toggleEdit() {
		editing = !editing;
		previewMode = false;
		if (editing) editContent = data.rawContent;
	}

	$effect(() => {
		if (form?.success) { editing = false; previewMode = false; }
	});
</script>

<svelte:head><title>{data.topic?.title || data.slug}</title></svelte:head>

{#if !data.topic}
	<h1>New topic: <em>{data.slug}</em></h1>
	<p class="not-found">This topic doesn't exist yet. Create it below.</p>
	<form method="POST" action="?/save">
		<label class="field-label">Title
			<input type="text" name="title" bind:value={newTitle} class="title-input" placeholder={data.slug} />
		</label>
		<textarea name="content" rows="12" class="editor" placeholder="Write in markdown..."></textarea>
		<div class="actions">
			<button type="submit" class="save-btn">Create topic</button>
			<a href="/kb" class="cancel-link">Cancel</a>
		</div>
	</form>
{:else}
	<div class="header">
		<div class="breadcrumb"><a href="/kb">KB</a> <span class="sep">/</span> <span>{data.topic.title || data.topic.slug}</span></div>
		<h1>{data.topic.title || data.topic.slug}</h1>
		<div class="header-actions">
			{#if confirmDelete}
				<span class="confirm-text">Delete?</span>
				<form method="POST" action="?/delete" style="display:inline">
					<button type="submit" class="del-confirm-btn">Yes, delete</button>
				</form>
				<button type="button" class="cancel-del-btn" onclick={() => confirmDelete = false}>Cancel</button>
			{:else}
				<button onclick={toggleEdit} class="edit-btn">{editing ? 'View' : 'Edit'}</button>
				<button onclick={() => { editing = false; confirmDelete = true; }} class="del-btn">Delete</button>
			{/if}
		</div>
	</div>

	{#if data.topic.tags?.length}
		<div class="tags">
			{#each data.topic.tags as tag}
				<a href="/kb?tag={tag}" class="tag">{tag}</a>
			{/each}
		</div>
	{/if}

	{#if data.topic.updated}
		<p class="meta">Updated {data.topic.updated}</p>
	{/if}

	{#if editing}
		<form method="POST" action="?/save">
			<div class="edit-tabs">
				<button type="button" class="tab" class:active={!previewMode} onclick={() => previewMode = false}>Write</button>
				<button type="button" class="tab" class:active={previewMode} onclick={() => previewMode = true}>Preview</button>
			</div>
			{#if previewMode}
				<input type="hidden" name="content" value={editContent} />
				<article class="content preview-box">{@html previewHtml}</article>
			{:else}
				<textarea name="content" bind:value={editContent} rows="20" class="editor"></textarea>
			{/if}
			<div class="actions">
				<button type="submit" class="save-btn">Save</button>
				<button type="button" onclick={() => editing = false}>Cancel</button>
			</div>
		</form>
		{#if form?.success}<p class="saved">Saved.</p>{/if}
	{:else}
		<article class="content">
			{@html data.topic.html}
		</article>
	{/if}

	{#if data.topic.backlinks?.length}
		<section class="backlinks">
			<h3>Backlinks</h3>
			<ul>
				{#each data.topic.backlinks as bl}
					<li><a href="/kb/{bl.slug}">{bl.title}</a></li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style>
	.not-found { color: var(--text-muted); margin-bottom: 1em; }
	.field-label { display: block; font-size: 0.9em; color: var(--text-muted); margin-bottom: 0.5em; }
	.title-input {
		display: block; width: 100%; margin-top: 0.25em;
		padding: 0.5em 0.75em; border: 1px solid var(--border);
		border-radius: 6px; font-size: 1em; background: var(--bg-surface); color: var(--text);
		box-sizing: border-box;
	}
	.cancel-link { color: var(--text-muted); font-size: 0.9em; align-self: center; }
	.header { display: flex; align-items: center; justify-content: space-between; }
	.header-actions { display: flex; gap: 0.4em; align-items: center; }
	.edit-btn {
		padding: 0.4em 0.8em; border: 1px solid var(--border);
		border-radius: 6px; background: var(--bg-surface); cursor: pointer; color: var(--text);
	}
	.del-btn {
		padding: 0.4em 0.8em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg-surface); cursor: pointer; color: var(--error); font-size: 0.9em;
	}
	.del-confirm-btn {
		background: var(--error); color: #fff; border: none; border-radius: 6px;
		padding: 0.35em 0.7em; cursor: pointer; font-size: 0.85em;
	}
	.cancel-del-btn {
		background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85em; padding: 0.35em 0;
	}
	.confirm-text { font-size: 0.85em; color: var(--error); }
	.tags { display: flex; gap: 0.4em; margin-bottom: 0.5em; }
	.tag {
		font-size: 0.8em; padding: 0.2em 0.6em;
		background: var(--code-bg); border-radius: 12px; color: var(--text-muted);
	}
	.meta { color: var(--text-muted); font-size: 0.85em; margin: 0; }
	.content { margin-top: 1em; }
	.editor {
		width: 100%; font-family: monospace; font-size: 0.9em;
		padding: 0.75em; border: 1px solid var(--border); border-radius: 6px;
		box-sizing: border-box; background: var(--bg-surface); color: var(--text);
	}
	.edit-tabs { display: flex; gap: 0.25em; margin-bottom: 0.5em; }
	.tab { padding: 0.35em 0.7em; border: 1px solid var(--border); border-radius: 6px 6px 0 0; background: var(--bg); color: var(--text-muted); cursor: pointer; font-size: 0.85em; }
	.tab.active { background: var(--bg-surface); color: var(--text); font-weight: 600; border-bottom-color: var(--bg-surface); }
	.preview-box { min-height: 10em; padding: 0.75em; border: 1px solid var(--border); border-radius: 0 6px 6px 6px; background: var(--bg-surface); }
	.actions { display: flex; gap: 0.5em; margin-top: 0.5em; }
	.save-btn { background: var(--link); color: #fff; border: none; padding: 0.5em 1em; border-radius: 6px; cursor: pointer; }
	.saved { color: var(--success); }
	.backlinks { margin-top: 2em; padding-top: 1em; border-top: 1px solid var(--border); }
	.backlinks ul { padding-left: 1.2em; }
	.breadcrumb { font-size: 0.82em; color: var(--text-muted); margin-bottom: 0.2em; }
	.breadcrumb a { color: var(--link); text-decoration: none; }
	.breadcrumb a:hover { text-decoration: underline; }
	.breadcrumb .sep { margin: 0 0.3em; }
</style>

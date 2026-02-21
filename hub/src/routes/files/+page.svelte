<script>
	let { data } = $props();
	let files = $state(data.files || []);
	let uploading = $state(false);
	let dragOver = $state(false);
	let error = $state('');

	function fmtSize(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fmtDate(iso) {
		const d = new Date(iso);
		const now = new Date();
		if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return d.toLocaleDateString();
	}

	async function uploadFiles(fileList) {
		if (!fileList?.length) return;
		uploading = true; error = '';
		for (const file of fileList) {
			const form = new FormData();
			form.append('file', file);
			try {
				const res = await fetch('/api/files', { method: 'POST', body: form });
				const d = await res.json();
				if (!res.ok) { error = d.error || 'Upload failed'; continue; }
				files = [d, ...files.filter(f => f.name !== d.name)];
			} catch { error = 'Upload failed'; }
		}
		uploading = false;
	}

	function onDrop(e) { e.preventDefault(); dragOver = false; uploadFiles(e.dataTransfer?.files); }
	function onDragOver(e) { e.preventDefault(); dragOver = true; }
	function onDragLeave() { dragOver = false; }
	function onFileInput(e) { uploadFiles(e.target.files); e.target.value = ''; }

	async function deleteFile(name) {
		try {
			const res = await fetch(`/api/files?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
			if (res.ok) files = files.filter(f => f.name !== name);
		} catch { /* ignore */ }
	}
</script>

<svelte:head><title>Files — Relaygent</title></svelte:head>

<h1>Shared Files</h1>
<p class="desc">Drop files here for the agent, or download files the agent has shared with you.</p>

<div class="drop-zone" class:over={dragOver} class:uploading ondrop={onDrop} ondragover={onDragOver} ondragleave={onDragLeave}>
	{#if uploading}
		<div class="dz-text">Uploading...</div>
	{:else}
		<div class="dz-text">Drag & drop files here</div>
		<div class="dz-or">or</div>
		<label class="dz-btn"><input type="file" multiple onchange={onFileInput} hidden>Choose files</label>
	{/if}
</div>
{#if error}<p class="err">{error}</p>{/if}

{#if files.length === 0}
	<p class="empty">No shared files yet.</p>
{:else}
	<div class="file-list">
		{#each files as f}
			<div class="file-row">
				<a href="/api/files/download?name={encodeURIComponent(f.name)}" class="fname" download>{f.name}</a>
				<span class="fmeta">{fmtSize(f.size)}</span>
				<span class="fmeta">{fmtDate(f.modified)}</span>
				<button class="fdel" onclick={() => deleteFile(f.name)} title="Delete">x</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	h1 { margin-top: 0; }
	.desc { color: var(--text-muted); font-size: 0.85em; margin: 0 0 1em; }
	.drop-zone { border: 2px dashed var(--border); border-radius: 8px; padding: 2em; text-align: center; margin-bottom: 1em; transition: border-color 0.15s, background 0.15s; }
	.drop-zone.over { border-color: var(--link); background: color-mix(in srgb, var(--link) 5%, var(--bg-surface)); }
	.drop-zone.uploading { opacity: 0.6; }
	.dz-text { font-weight: 600; color: var(--text-muted); margin-bottom: 0.3em; }
	.dz-or { font-size: 0.8em; color: var(--text-muted); margin-bottom: 0.3em; }
	.dz-btn { display: inline-block; padding: 0.4em 0.8em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.85em; color: var(--text); }
	.dz-btn:hover { border-color: var(--link); color: var(--link); }
	.err { color: #dc2626; font-size: 0.85em; }
	.empty { color: var(--text-muted); font-style: italic; }
	.file-list { display: flex; flex-direction: column; gap: 2px; }
	.file-row { display: flex; align-items: center; gap: 0.75em; padding: 0.5em 0.75em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; }
	.fname { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fmeta { font-size: 0.78em; color: var(--text-muted); white-space: nowrap; }
	.fdel { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.9em; padding: 0.2em 0.4em; }
	.fdel:hover { color: #dc2626; }
</style>

<script>
	import FilePreview from '$lib/components/FilePreview.svelte';
	import { typeOf, isVideo } from '$lib/fileTypes.js';
	let { data } = $props();
	let files = $state(data.files || []);
	let uploading = $state(false);
	let dragOver = $state(false);
	let error = $state('');
	let uploadProgress = $state('');
	let preview = $state(null);
	let filter = $state('all');
	let search = $state('');

	let filtered = $derived(files.filter(f => (filter === 'all' || typeOf(f.name) === filter) && (!search || f.name.toLowerCase().includes(search.toLowerCase()))));
	function fmtSize(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	function fmtDate(iso) {
		const d = new Date(iso);
		if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return d.toLocaleDateString();
	}

	function uploadOne(file) {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', `/api/files/stream?name=${encodeURIComponent(file.name)}`);
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) uploadProgress = `${file.name}: ${Math.round(e.loaded / e.total * 100)}%`;
			};
			xhr.onload = () => {
				try {
					const d = JSON.parse(xhr.responseText);
					if (xhr.status >= 200 && xhr.status < 300) files = [d, ...files.filter(x => x.name !== d.name)];
					else error = d.error || 'Upload failed';
				} catch { error = 'Upload failed'; }
				resolve();
			};
			xhr.onerror = () => { error = 'Upload failed'; resolve(); };
			xhr.send(file);
		});
	}
	async function uploadFiles(fileList) {
		if (!fileList?.length) return;
		uploading = true; error = ''; uploadProgress = '';
		for (const file of fileList) await uploadOne(file);
		uploading = false; uploadProgress = '';
	}
	function onDrop(e) { e.preventDefault(); dragOver = false; uploadFiles(e.dataTransfer?.files); }
	function onDragOver(e) { e.preventDefault(); dragOver = true; }
	function onFileInput(e) { uploadFiles(e.target.files); e.target.value = ''; }
	async function deleteFile(name) {
		try {
			const res = await fetch(`/api/files?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
			if (res.ok) { files = files.filter(f => f.name !== name); if (preview?.name === name) preview = null; }
		} catch { /* ignore */ }
	}
</script>

<svelte:head><title>Files — Relaygent</title></svelte:head>

<h1>Shared Files</h1>
<p class="desc">Drop files here for the agent, or download files the agent has shared with you.</p>

<div class="drop-zone" class:over={dragOver} class:uploading ondrop={onDrop} ondragover={onDragOver} ondragleave={() => dragOver = false}>
	{#if uploading}
		<div class="dz-text">{uploadProgress || 'Uploading...'}</div>
	{:else}
		<div class="dz-text">Drag & drop files here</div>
		<label class="dz-btn"><input type="file" multiple onchange={onFileInput} hidden>Choose files</label>
	{/if}
</div>
{#if error}<p class="err">{error}</p>{/if}

{#if files.length === 0}
	<p class="empty">No shared files yet.</p>
{:else}
	<div class="filters">
		{#each ['all', 'video', 'audio', 'image', 'other'] as t}
			<button class="filter-btn" class:active={filter === t} onclick={() => filter = t}>{t} {t === 'all' ? `(${files.length})` : `(${files.filter(f => typeOf(f.name) === t).length})`}</button>
		{/each}
		<input class="search" type="text" placeholder="Search files..." bind:value={search} />
	</div>
	<div class="file-list">
		{#each filtered as f}
			<div class="file-row" class:active={preview?.name === f.name}>
				<button class="fname" onclick={() => preview = f}>{#if isVideo(f.name)}<img class="thumb" src="/api/files/thumbnail?name={encodeURIComponent(f.name)}" alt="" loading="lazy" />{/if}{f.name}</button>
				<span class="fmeta">{fmtSize(f.size)}</span>
				<span class="fmeta">{fmtDate(f.modified)}</span>
				<a href="/api/files/download?name={encodeURIComponent(f.name)}" class="fbtn" download title="Download">↓</a>
				<button class="fbtn del" onclick={() => deleteFile(f.name)} title="Delete">×</button>
			</div>
		{/each}
	</div>
{/if}

{#if preview}
	<FilePreview file={preview} filtered={filtered} onclose={() => preview = null} onnavigate={(f) => preview = f} />
{/if}

<style>
	h1 { margin-top: 0; }
	.desc { color: var(--text-muted); font-size: 0.85em; margin: 0 0 1em; }
	.drop-zone { border: 2px dashed var(--border); border-radius: 8px; padding: 1.5em; text-align: center; margin-bottom: 1em; transition: border-color 0.15s; }
	.drop-zone.over { border-color: var(--link); background: color-mix(in srgb, var(--link) 5%, var(--bg-surface)); }
	.drop-zone.uploading { opacity: 0.6; }
	.dz-text { font-weight: 600; color: var(--text-muted); margin-bottom: 0.3em; }
	.dz-btn { display: inline-block; padding: 0.4em 0.8em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.85em; color: var(--text); }
	.dz-btn:hover { border-color: var(--link); color: var(--link); }
	.err { color: var(--error); font-size: 0.85em; }
	.empty { color: var(--text-muted); font-style: italic; }
	.file-list { display: flex; flex-direction: column; gap: 2px; }
	.file-row { display: flex; align-items: center; gap: 0.5em; padding: 0.4em 0.75em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; }
	.file-row.active { border-color: var(--link); background: color-mix(in srgb, var(--link) 5%, var(--bg-surface)); }
	.fname { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: none; color: var(--link); cursor: pointer; text-align: left; padding: 0; font-size: inherit; }
	.fname:hover { text-decoration: underline; }
	.thumb { width: 40px; height: 24px; object-fit: cover; border-radius: 3px; margin-right: 0.4em; vertical-align: middle; }
	.fmeta { font-size: 0.78em; color: var(--text-muted); white-space: nowrap; }
	.fbtn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.95em; padding: 0.15em 0.35em; text-decoration: none; }
	.fbtn:hover { color: var(--link); }
	.fbtn.del:hover { color: var(--error); }
	.filters { display: flex; gap: 0.4em; margin-bottom: 0.75em; flex-wrap: wrap; }
	.filter-btn { padding: 0.25em 0.6em; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-size: 0.8em; text-transform: capitalize; }
	.filter-btn.active { border-color: var(--link); color: var(--link); background: color-mix(in srgb, var(--link) 8%, var(--bg-surface)); }
	.filter-btn:hover { border-color: var(--link); }
	.search { flex: 1; padding: 0.25em 0.6em; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text); font-size: 0.8em; min-width: 120px; }
	.search:focus { outline: none; border-color: var(--link); }
</style>

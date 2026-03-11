<script>
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import { isMd, isImage, isText, isVideo, isAudio } from '$lib/fileTypes.js';

	let { file, filtered = [], onclose, onnavigate } = $props();
	let previewText = $state('');
	let loading = $state(false);
	let currentName = $state('');

	$effect(() => {
		if (file && file.name !== currentName) {
			currentName = file.name;
			previewText = '';
			if (isText(file.name)) {
				loading = true;
				fetch(`/api/files/view?name=${encodeURIComponent(file.name)}`)
					.then(r => r.text()).then(t => { previewText = t; loading = false; })
					.catch(() => { previewText = 'Failed to load file'; loading = false; });
			}
		}
	});

	function nav(delta) {
		const idx = filtered.findIndex(f => f.name === file.name);
		const next = filtered[idx + delta];
		if (next) onnavigate(next);
	}
	function onBackdrop(e) { if (e.target === e.currentTarget) onclose(); }
	function onKey(e) {
		if (e.key === 'ArrowLeft') nav(-1);
		else if (e.key === 'ArrowRight') nav(1);
		else if (e.key === 'Escape') onclose();
	}
	function viewUrl(name) { return `/api/files/view?name=${encodeURIComponent(name)}`; }
	function dlUrl(name) { return `/api/files/download?name=${encodeURIComponent(name)}`; }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onBackdrop}>
	<div class="modal">
		<div class="modal-header">
			<button class="nav-btn" onclick={() => nav(-1)} title="Previous (←)">&#8592;</button>
			<strong class="modal-title">{file.name}</strong>
			<div class="header-actions">
				<a href={dlUrl(file.name)} class="nav-btn" download title="Download">↓</a>
				<button class="nav-btn" onclick={() => nav(1)} title="Next (→)">&#8594;</button>
				<button class="nav-btn close" onclick={onclose} title="Close (Esc)">×</button>
			</div>
		</div>
		<div class="modal-body">
			{#if isVideo(file.name)}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={viewUrl(file.name)} controls autoplay onended={() => nav(1)}></video>
			{:else if isAudio(file.name)}
				<audio src={viewUrl(file.name)} controls autoplay></audio>
			{:else if isImage(file.name)}
				<img src={viewUrl(file.name)} alt={file.name} />
			{:else if loading}
				<p class="muted">Loading...</p>
			{:else if isMd(file.name)}
				<MarkdownRenderer source={previewText} />
			{:else if isText(file.name)}
				<pre>{previewText}</pre>
			{:else}
				<p class="muted">No preview available. <a href={dlUrl(file.name)} download>Download</a></p>
			{/if}
		</div>
	</div>
</div>

<style>
	.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 1.5em; }
	.modal { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; width: 100%; max-width: 900px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
	.modal-header { display: flex; align-items: center; gap: 0.5em; padding: 0.6em 0.75em; border-bottom: 1px solid var(--border); background: var(--bg-surface); border-radius: 10px 10px 0 0; }
	.modal-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95em; }
	.header-actions { display: flex; gap: 0.25em; }
	.nav-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.1em; padding: 0.2em 0.4em; border-radius: 4px; text-decoration: none; }
	.nav-btn:hover { color: var(--link); background: var(--bg-surface); }
	.nav-btn.close:hover { color: var(--error); }
	.modal-body { padding: 1em; overflow: auto; flex: 1; display: flex; align-items: center; justify-content: center; }
	.modal-body video { max-width: 100%; max-height: 75vh; border-radius: 4px; }
	.modal-body audio { width: 100%; }
	.modal-body img { max-width: 100%; max-height: 75vh; object-fit: contain; border-radius: 4px; }
	.modal-body pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.85em; line-height: 1.5; max-height: 70vh; overflow: auto; width: 100%; }
	.muted { color: var(--text-muted); }
</style>

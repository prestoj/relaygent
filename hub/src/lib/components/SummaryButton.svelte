<script>
	import { sanitizeHtml } from '$lib/sanitize.js';
	import { marked } from 'marked';
	let summaryText = $state('');
	let summaryLoading = $state(false);
	async function fetchSummary() {
		if (summaryLoading) return;
		summaryLoading = true; summaryText = '';
		try { const d = await (await fetch('/api/summary?session=current')).json(); summaryText = d.summary || d.error || 'No summary available'; }
		catch { summaryText = 'Failed to generate summary'; }
		summaryLoading = false;
	}
</script>

<section class="summary-section">
	<div class="summary-hdr">
		<button class="summary-btn" onclick={fetchSummary} disabled={summaryLoading}>{summaryLoading ? 'Generating...' : "What's happening?"}</button>
		{#if summaryText}<button class="summary-dismiss" onclick={() => summaryText = ''}>Dismiss</button>{/if}
	</div>
	{#if summaryText}<div class="summary-text">{@html sanitizeHtml(marked.parse(summaryText))}</div>{/if}
</section>

<style>
	.summary-section { margin-bottom: 1em; }
	.summary-hdr { display: flex; align-items: center; gap: 0.5em; }
	.summary-btn { padding: 0.4em 0.8em; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); cursor: pointer; font-size: 0.82em; font-weight: 600; color: var(--text-muted); }
	.summary-btn:hover:not(:disabled) { border-color: var(--link); color: var(--link); }  .summary-btn:disabled { opacity: 0.6; cursor: wait; }
	.summary-dismiss { background: none; border: none; font-size: 0.78em; color: var(--text-muted); cursor: pointer; padding: 0.2em 0.4em; }  .summary-dismiss:hover { color: var(--text); }
	.summary-text { margin-top: 0.5em; padding: 0.6em 0.8em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.85em; line-height: 1.5; color: var(--text); }
</style>

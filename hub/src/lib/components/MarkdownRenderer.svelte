<script>
	/** Lightweight markdown-to-HTML renderer. Handles headings, bold, italic,
	 *  links, code blocks, inline code, tables, lists, and horizontal rules. */
	let { source = '' } = $props();

	function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

	function render(md) {
		if (!md) return '';
		const lines = md.split('\n');
		const out = [];
		let inCode = false, codeBuf = [], codeLang = '';
		let inTable = false, tableBuf = [];

		function flushTable() {
			if (!tableBuf.length) return;
			const rows = tableBuf.map(r => r.split('|').map(c => c.trim()).filter(c => c !== ''));
			if (rows.length < 2) { tableBuf = []; inTable = false; return; }
			let h = '<table><thead><tr>' + rows[0].map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
			for (let i = 2; i < rows.length; i++) h += '<tr>' + rows[i].map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
			out.push(h + '</tbody></table>');
			tableBuf = []; inTable = false;
		}

		function inline(s) {
			s = escHtml(s);
			s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
			s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
			s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
			s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
			return s;
		}

		for (const line of lines) {
			if (line.startsWith('```')) {
				if (inCode) { out.push(`<pre class="code-block${codeLang ? ' lang-'+codeLang : ''}"><code>${escHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; inCode = false; codeLang = ''; }
				else { if (inTable) flushTable(); inCode = true; codeLang = line.slice(3).trim(); }
				continue;
			}
			if (inCode) { codeBuf.push(line); continue; }

			const trimmed = line.trim();
			if (!trimmed) { if (inTable) flushTable(); out.push(''); continue; }

			if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
				if (trimmed.replace(/[|\s:-]/g, '') === '') { inTable = true; tableBuf.push(trimmed); continue; }
				inTable = true; tableBuf.push(trimmed); continue;
			}
			if (inTable) flushTable();

			if (trimmed === '---' || trimmed === '***' || trimmed === '___') { out.push('<hr>'); continue; }
			if (trimmed.startsWith('# ')) { out.push(`<h1>${inline(trimmed.slice(2))}</h1>`); continue; }
			if (trimmed.startsWith('## ')) { out.push(`<h2>${inline(trimmed.slice(3))}</h2>`); continue; }
			if (trimmed.startsWith('### ')) { out.push(`<h3>${inline(trimmed.slice(4))}</h3>`); continue; }
			if (trimmed.startsWith('#### ')) { out.push(`<h4>${inline(trimmed.slice(5))}</h4>`); continue; }
			if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) { out.push(`<li>${inline(trimmed.slice(2))}</li>`); continue; }
			if (/^\d+\.\s/.test(trimmed)) { out.push(`<li>${inline(trimmed.replace(/^\d+\.\s/, ''))}</li>`); continue; }
			out.push(`<p>${inline(trimmed)}</p>`);
		}
		if (inTable) flushTable();
		if (inCode) out.push(`<pre class="code-block"><code>${escHtml(codeBuf.join('\n'))}</code></pre>`);

		// Wrap consecutive <li> in <ul>
		let html = out.join('\n');
		html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
		return html;
	}

	let html = $derived(render(source));
</script>

<div class="md-render">{@html html}</div>

<style>
	.md-render { line-height: 1.6; font-size: 0.9em; }
	.md-render :global(h1) { font-size: 1.3em; margin: 0.8em 0 0.3em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
	.md-render :global(h2) { font-size: 1.15em; margin: 0.7em 0 0.3em; }
	.md-render :global(h3) { font-size: 1em; margin: 0.6em 0 0.2em; }
	.md-render :global(h4) { font-size: 0.9em; margin: 0.5em 0 0.2em; color: var(--text-muted); }
	.md-render :global(p) { margin: 0.3em 0; }
	.md-render :global(hr) { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
	.md-render :global(ul) { padding-left: 1.5em; margin: 0.3em 0; }
	.md-render :global(li) { margin: 0.15em 0; }
	.md-render :global(strong) { font-weight: 600; }
	.md-render :global(code) { background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
	.md-render :global(a) { color: var(--link); }
	.md-render :global(table) { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 0.92em; }
	.md-render :global(th), .md-render :global(td) { border: 1px solid var(--border); padding: 0.3em 0.6em; text-align: left; }
	.md-render :global(th) { background: var(--code-bg); font-weight: 600; }
	.md-render :global(.code-block) { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.6em 0.8em; overflow-x: auto; font-size: 0.88em; margin: 0.5em 0; }
</style>

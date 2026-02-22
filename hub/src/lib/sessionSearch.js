import fs from 'fs';
import path from 'path';

function getRunsPrefix() {
	try {
		const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.relaygent', 'config.json'), 'utf-8'));
		return path.join(cfg.paths.repo, 'harness', 'runs').replace(/[/.]/g, '-');
	} catch { return null; }
}

/** Extract a readable snippet from a JSONL line containing a query match */
function extractSnippet(line, query) {
	try {
		const entry = JSON.parse(line);
		if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
			const texts = entry.message.content
				.filter(i => i?.type === 'text').map(i => i.text);
			if (texts.length) {
				const full = texts.join(' ');
				const idx = full.toLowerCase().indexOf(query);
				if (idx !== -1) {
					const s = Math.max(0, idx - 60), e = Math.min(full.length, idx + query.length + 60);
					return (s > 0 ? '...' : '') + full.slice(s, e).replace(/\n/g, ' ').trim() + (e < full.length ? '...' : '');
				}
			}
		}
	} catch { /* fall through */ }
	// Fallback: clean up raw JSON text around the match
	const idx = line.toLowerCase().indexOf(query);
	const s = Math.max(0, idx - 60), e = Math.min(line.length, idx + query.length + 60);
	return (s > 0 ? '...' : '') +
		line.slice(s, e).replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/["{}\[\]\\]/g, '').replace(/\s+/g, ' ').trim() +
		(e < line.length ? '...' : '');
}

/** Search all relay sessions for a query string. Returns up to maxResults matches. */
export function searchSessions(query, maxResults = 8) {
	if (!query || query.length < 2) return [];
	const q = query.toLowerCase();
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	const prefix = getRunsPrefix();
	const results = [];

	let dirs;
	try { dirs = fs.readdirSync(claudeProjects).filter(d => !prefix || d.startsWith(prefix)); } catch { return []; }

	for (const dir of dirs.sort().reverse()) {
		if (results.length >= maxResults) break;
		const fullPath = path.join(claudeProjects, dir);
		try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }

		const m = dir.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
		if (!m) continue;
		const runId = m[0];

		let files;
		try { files = fs.readdirSync(fullPath).filter(f => f.endsWith('.jsonl')); } catch { continue; }
		// Search newest sessions first (by mtime)
		files.sort((a, b) => {
			try { return fs.statSync(path.join(fullPath, b)).mtimeMs - fs.statSync(path.join(fullPath, a)).mtimeMs; }
			catch { return 0; }
		});

		for (const f of files) {
			if (results.length >= maxResults) break;
			const fp = path.join(fullPath, f);
			try { if (fs.statSync(fp).size < 200) continue; } catch { continue; }
			const uuid8 = f.slice(0, -6).slice(0, 8);
			const id = `${runId}--${uuid8}`;

			try {
				const lines = fs.readFileSync(fp, 'utf-8').split('\n');
				for (const line of lines) {
					if (line.toLowerCase().includes(q)) {
						const snippet = extractSnippet(line, q);
						results.push({ type: 'session', id, displayTime: `${m[1]} ${m[2]}:${m[3]}`, snippet });
						break;
					}
				}
			} catch { /* ignore */ }
		}
	}

	return results;
}

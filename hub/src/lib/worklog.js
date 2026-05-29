import fs from 'fs';
import path from 'path';

// Resolve the data dir the same way every relaygent service does, so the `worklog`
// CLI and the hub read/write the exact same file regardless of who's running.
const CONFIG_FILE = path.join(process.env.HOME || '', '.relaygent', 'config.json');
function dataDir() {
	if (process.env.RELAYGENT_DATA_DIR) return process.env.RELAYGENT_DATA_DIR;
	try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).paths?.data || path.join(process.env.HOME, 'data'); }
	catch { return path.join(process.env.HOME || '', 'data'); }
}
const LOG_FILE = () => path.join(dataDir(), 'worklog.jsonl');

// One log line = one accomplishment. `kind` drives the colored dot in the UI.
export const KINDS = ['pr', 'fix', 'feature', 'ops', 'trade', 'note'];

export function appendEntry({ title, detail = '', kind = 'note', link = '', ts } = {}) {
	if (!title || typeof title !== 'string') return { error: 'title required' };
	const entry = {
		ts: ts || new Date().toISOString(),
		kind: KINDS.includes(kind) ? kind : 'note',
		title: title.slice(0, 300),
		detail: String(detail || '').slice(0, 2000),
		link: String(link || '').slice(0, 500),
	};
	try {
		fs.mkdirSync(path.dirname(LOG_FILE()), { recursive: true });
		fs.appendFileSync(LOG_FILE(), JSON.stringify(entry) + '\n');
		return { ok: true, entry };
	} catch (e) { return { error: e.message || 'append failed' }; }
}

// Newest-first list. Tolerates malformed lines (skips them).
export function listEntries({ limit = 200 } = {}) {
	let raw;
	try { raw = fs.readFileSync(LOG_FILE(), 'utf8'); } catch { return []; }
	const out = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
	}
	out.reverse();
	return out.slice(0, limit);
}

// Group newest-first entries by local YYYY-MM-DD for the day-sectioned UI.
export function groupByDay(entries) {
	const groups = [];
	let cur = null;
	for (const e of entries) {
		const day = (e.ts || '').slice(0, 10);
		if (!cur || cur.day !== day) { cur = { day, entries: [] }; groups.push(cur); }
		cur.entries.push(e);
	}
	return groups;
}

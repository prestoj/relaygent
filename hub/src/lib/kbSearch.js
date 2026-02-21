import fs from 'fs';
import { getKbDir, listTopics } from './kb.js';
import path from 'path';

/** Resolve slug to filepath, validated against KB_DIR */
function safeSlugPath(slug) {
	const kbDir = getKbDir();
	const filepath = path.join(kbDir, `${slug}.md`);
	const resolved = path.resolve(filepath);
	if (!resolved.startsWith(path.resolve(kbDir))) throw new Error('Invalid slug');
	return filepath;
}

/** Search KB topics by query string */
export function searchTopics(query) {
	if (!query) return [];
	const q = query.toLowerCase();
	return listTopics().map(t => {
		let raw;
		try { raw = fs.readFileSync(safeSlugPath(t.slug), 'utf-8'); } catch { return null; }
		const lower = raw.toLowerCase();
		const idx = lower.indexOf(q);
		if (idx === -1) return null;
		const contentStart = raw.indexOf('---', 3);
		const content = contentStart > -1 ? raw.slice(contentStart + 3) : raw;
		const cLower = content.toLowerCase();
		const cIdx = cLower.indexOf(q);
		let snippet = '';
		if (cIdx > -1) {
			const start = Math.max(0, cIdx - 60);
			const end = Math.min(content.length, cIdx + q.length + 60);
			snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ').trim() + (end < content.length ? '...' : '');
		}
		return { ...t, type: 'topic', snippet };
	}).filter(Boolean);
}

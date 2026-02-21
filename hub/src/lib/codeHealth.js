import fs from 'fs';
import path from 'path';

const THRESHOLD = 150;
const LIMIT = 200;
const DIRS = ['harness', 'hub/src', 'hooks', 'notifications', 'computer-use', 'hammerspoon', 'bin', 'setup'];
const EXTS = new Set(['.py', '.js', '.mjs', '.svelte', '.ts', '.sh', '.bash']);
const SKIP = new Set(['node_modules', '.svelte-kit', 'build', '.venv']);

/** Scan source files and return those approaching the line limit. */
export function getCodeHealth(repoRoot) {
	const files = [];
	function walk(dir) {
		let entries;
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (SKIP.has(e.name)) continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) { walk(full); continue; }
			if (!e.isFile() || !EXTS.has(path.extname(e.name))) continue;
			try {
				const lines = fs.readFileSync(full, 'utf-8').split('\n').length - 1;
				if (lines >= THRESHOLD) files.push({ path: full.slice(repoRoot.length + 1), lines, pct: Math.round(lines / LIMIT * 100) });
			} catch { /* skip */ }
		}
	}
	for (const d of DIRS) walk(path.join(repoRoot, d));
	files.sort((a, b) => b.lines - a.lines);
	return { files, threshold: THRESHOLD, limit: LIMIT };
}

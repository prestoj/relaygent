import fs from 'fs';
import path from 'path';

const REPO_DIR = path.join(import.meta.dirname, '..', '..', '..');
const SHARED_DIR = path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'shared');

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const FORBIDDEN = /[/\\<>:"|?*\x00-\x1f]/;

export function getSharedDir() {
	fs.mkdirSync(SHARED_DIR, { recursive: true });
	return SHARED_DIR;
}

export function listFiles() {
	const dir = getSharedDir();
	try {
		return fs.readdirSync(dir)
			.filter(f => !f.startsWith('.'))
			.map(name => {
				const fp = path.join(dir, name);
				const stat = fs.statSync(fp);
				return { name, size: stat.size, modified: stat.mtime.toISOString(), isDir: stat.isDirectory() };
			})
			.filter(f => !f.isDir)
			.sort((a, b) => new Date(b.modified) - new Date(a.modified));
	} catch { return []; }
}

export function validateFilename(name) {
	if (!name || typeof name !== 'string') return 'Filename is required';
	if (name.length > 255) return 'Filename too long';
	if (FORBIDDEN.test(name)) return 'Invalid characters in filename';
	if (name === '.' || name === '..') return 'Invalid filename';
	if (name.startsWith('.')) return 'Hidden files not allowed';
	return null;
}

export function getFilePath(name) {
	const err = validateFilename(name);
	if (err) return { error: err };
	const fp = path.join(getSharedDir(), name);
	// Prevent path traversal
	if (!fp.startsWith(getSharedDir())) return { error: 'Invalid path' };
	return { path: fp };
}

export { MAX_FILE_SIZE };

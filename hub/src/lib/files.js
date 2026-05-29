import fs from 'fs';
import path from 'path';

const REPO_DIR = path.join(import.meta.dirname, '..', '..', '..');
// File-share root. RELAYGENT_SHARED_DIR lets it live somewhere intuitive (e.g. ~/shared)
// instead of being pinned under the data dir. Falls back to <data>/shared for compatibility.
const SHARED_DIR = process.env.RELAYGENT_SHARED_DIR
	|| path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'shared');

// Upload cap, overridable via RELAYGENT_MAX_UPLOAD_BYTES (default 50MB).
const MAX_FILE_SIZE = parseInt(process.env.RELAYGENT_MAX_UPLOAD_BYTES || '', 10) || 50 * 1024 * 1024;
const FORBIDDEN = /[/\\<>:"|?*\x00-\x1f]/;

export function getSharedDir() {
	fs.mkdirSync(SHARED_DIR, { recursive: true });
	return SHARED_DIR;
}

// Validate a single path segment (leaf name).
export function validateFilename(name) {
	if (!name || typeof name !== 'string') return 'Filename is required';
	if (name.length > 255) return 'Filename too long';
	if (FORBIDDEN.test(name)) return 'Invalid characters in filename';
	if (name === '.' || name === '..') return 'Invalid filename';
	if (name.startsWith('.')) return 'Hidden files not allowed';
	return null;
}

// Validate a relative path: one or more '/'-separated segments, each a valid leaf.
export function validatePath(relPath) {
	if (!relPath || typeof relPath !== 'string') return 'Path is required';
	if (path.isAbsolute(relPath)) return 'Absolute paths not allowed';
	const segments = relPath.split('/').filter(s => s !== '');
	if (segments.length === 0) return 'Path is required';
	for (const seg of segments) {
		const err = validateFilename(seg);
		if (err) return err;
	}
	return null;
}

// Resolve a relative path under the share root, guarding against traversal.
// Returns { path } (absolute) or { error }. Empty path resolves to the root.
export function safeResolve(relPath = '') {
	const root = getSharedDir();
	const abs = path.resolve(root, relPath || '.');
	const rel = path.relative(root, abs);
	if (rel.startsWith('..') || path.isAbsolute(rel)) return { error: 'Invalid path' };
	return { path: abs };
}

// List one folder under the share root. Folders (isDir:true) sort first, then files,
// both newest-first. Each entry carries a `path` relative to the root for navigation.
export function listFiles(subdir = '') {
	const resolved = safeResolve(subdir);
	if (resolved.error) return [];
	const root = getSharedDir();
	try {
		return fs.readdirSync(resolved.path)
			.filter(f => !f.startsWith('.'))
			.map(name => {
				const fp = path.join(resolved.path, name);
				const stat = fs.statSync(fp);
				return {
					name,
					path: path.relative(root, fp),
					size: stat.size,
					modified: stat.mtime.toISOString(),
					isDir: stat.isDirectory(),
				};
			})
			.sort((a, b) => (b.isDir - a.isDir) || (new Date(b.modified) - new Date(a.modified)));
	} catch { return []; }
}

// Resolve a path for serving (download/view/thumbnail). Rejects traversal/hidden/absolute
// up front; existence is left to the caller so a missing file surfaces as a 404, not 400.
export function getFilePath(relPath) {
	const err = validatePath(relPath);
	if (err) return { error: err };
	return safeResolve(relPath);
}

// Create a folder (and any missing parents) under the share root.
export function createDir(relPath) {
	const err = validatePath(relPath);
	if (err) return { error: err };
	const resolved = safeResolve(relPath);
	if (resolved.error) return resolved;
	try {
		fs.mkdirSync(resolved.path, { recursive: true });
		return { ok: true };
	} catch (e) { return { error: e.message || 'Could not create folder' }; }
}

// Rename or move a file/folder within the share (move = rename across folders).
export function renameEntry(from, to) {
	const fromErr = validatePath(from);
	if (fromErr) return { error: fromErr };
	const toErr = validatePath(to);
	if (toErr) return { error: toErr };
	const src = safeResolve(from);
	if (src.error) return src;
	const dst = safeResolve(to);
	if (dst.error) return dst;
	if (!fs.existsSync(src.path)) return { error: 'Source not found' };
	if (fs.existsSync(dst.path)) return { error: 'Destination already exists' };
	try {
		fs.mkdirSync(path.dirname(dst.path), { recursive: true });
		fs.renameSync(src.path, dst.path);
		return { ok: true };
	} catch (e) { return { error: e.message || 'Rename failed' }; }
}

// Delete a file, or a folder (non-empty folders require recursive:true).
export function deleteEntry(relPath, { recursive = false } = {}) {
	const err = validatePath(relPath);
	if (err) return { error: err };
	const resolved = safeResolve(relPath);
	if (resolved.error) return resolved;
	let stat;
	try { stat = fs.statSync(resolved.path); }
	catch { return { error: 'File not found' }; }
	try {
		if (stat.isDirectory()) {
			// .thumbnails is an internal cache — ignore it when judging "empty".
			const entries = fs.readdirSync(resolved.path).filter(f => f !== '.thumbnails');
			if (entries.length > 0 && !recursive) return { error: 'Folder not empty' };
			fs.rmSync(resolved.path, { recursive: true, force: true });
		} else {
			fs.unlinkSync(resolved.path);
		}
		return { ok: true };
	} catch (e) { return { error: e.message || 'Delete failed' }; }
}

export { MAX_FILE_SIZE };

import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import {
	listFiles, safeResolve, validatePath, createDir, renameEntry, deleteEntry, MAX_FILE_SIZE,
} from '$lib/files.js';

/** GET /api/files?path=subdir — list a folder in the share */
export function GET({ url } = {}) {
	const subdir = url?.searchParams.get('path') || '';
	return json({ files: listFiles(subdir), cwd: subdir });
}

/** POST /api/files?dir=relpath — create a folder; otherwise multipart upload into ?path */
export async function POST({ request, url }) {
	const dir = url.searchParams.get('dir');
	if (dir !== null) {
		const result = createDir(dir);
		return result.error
			? json({ error: result.error }, { status: 400 })
			: json({ ok: true }, { status: 201 });
	}

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.includes('multipart/form-data')) {
		return json({ error: 'Expected multipart/form-data' }, { status: 400 });
	}

	try {
		const formData = await request.formData();
		const file = formData.get('file');
		if (!file || typeof file === 'string') {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		const subdir = url.searchParams.get('path') || '';
		const rel = subdir ? `${subdir}/${file.name}` : file.name;
		const err = validatePath(rel);
		if (err) return json({ error: err }, { status: 400 });

		if (file.size > MAX_FILE_SIZE) {
			return json({ error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }, { status: 400 });
		}

		const dest = safeResolve(rel);
		if (dest.error) return json({ error: dest.error }, { status: 400 });

		fs.mkdirSync(path.dirname(dest.path), { recursive: true });
		fs.writeFileSync(dest.path, Buffer.from(await file.arrayBuffer()));
		const stat = fs.statSync(dest.path);
		return json(
			{ name: file.name, path: rel, size: stat.size, modified: stat.mtime.toISOString(), isDir: false },
			{ status: 201 },
		);
	} catch (e) {
		return json({ error: e.message || 'Upload failed' }, { status: 500 });
	}
}

/** PATCH /api/files?from=a&to=b — rename or move a file/folder */
export function PATCH({ url }) {
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const result = renameEntry(from, to);
	if (result.error) {
		const status = result.error === 'Destination already exists' ? 409
			: /not found/i.test(result.error) ? 404 : 400;
		return json({ error: result.error }, { status });
	}
	return json({ ok: true });
}

/** DELETE /api/files?name=path[&recursive=1] — delete a file or folder */
export function DELETE({ url }) {
	const name = url.searchParams.get('name');
	const recursive = url.searchParams.get('recursive') === '1';
	const result = deleteEntry(name, { recursive });
	if (result.error) {
		const status = result.error === 'Folder not empty' ? 409
			: /not found/i.test(result.error) ? 404 : 400;
		return json({ error: result.error }, { status });
	}
	return json({ ok: true });
}

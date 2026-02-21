import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import { listFiles, getSharedDir, validateFilename, MAX_FILE_SIZE } from '$lib/files.js';

/** GET /api/files — list shared files */
export function GET() {
	return json({ files: listFiles() });
}

/** POST /api/files — upload a file (multipart form data) */
export async function POST({ request }) {
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

		const name = file.name;
		const err = validateFilename(name);
		if (err) return json({ error: err }, { status: 400 });

		if (file.size > MAX_FILE_SIZE) {
			return json({ error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }, { status: 400 });
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const dest = path.join(getSharedDir(), name);
		if (!dest.startsWith(getSharedDir())) {
			return json({ error: 'Invalid path' }, { status: 400 });
		}

		fs.writeFileSync(dest, buffer);
		const stat = fs.statSync(dest);
		return json({ name, size: stat.size, modified: stat.mtime.toISOString() }, { status: 201 });
	} catch (e) {
		return json({ error: e.message || 'Upload failed' }, { status: 500 });
	}
}

/** DELETE /api/files?name=filename — delete a file */
export async function DELETE({ url }) {
	const name = url.searchParams.get('name');
	const err = validateFilename(name);
	if (err) return json({ error: err }, { status: 400 });

	const fp = path.join(getSharedDir(), name);
	if (!fp.startsWith(getSharedDir())) {
		return json({ error: 'Invalid path' }, { status: 400 });
	}

	try {
		fs.unlinkSync(fp);
		return json({ ok: true });
	} catch {
		return json({ error: 'File not found' }, { status: 404 });
	}
}

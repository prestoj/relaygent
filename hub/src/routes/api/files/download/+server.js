import fs from 'fs';
import path from 'path';
import { getFilePath } from '$lib/files.js';

/** GET /api/files/download?name=path — download a file (name may be a subpath) */
export function GET({ url }) {
	const name = url.searchParams.get('name');
	const result = getFilePath(name);
	if (result.error) return new Response(result.error, { status: 400 });

	try {
		const buffer = fs.readFileSync(result.path);
		return new Response(buffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(name))}"`,
				'Content-Length': buffer.length.toString(),
			},
		});
	} catch {
		return new Response('File not found', { status: 404 });
	}
}

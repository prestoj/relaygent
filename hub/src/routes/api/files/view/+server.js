import fs from 'fs';
import path from 'path';
import { getFilePath } from '$lib/files.js';

const MIME = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
	'.pdf': 'application/pdf',
	'.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
	'.py': 'text/plain; charset=utf-8', '.js': 'text/plain; charset=utf-8',
	'.sh': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8',
	'.yml': 'text/plain; charset=utf-8', '.toml': 'text/plain; charset=utf-8',
};

/** GET /api/files/view?name=filename — serve file inline with proper Content-Type */
export function GET({ url }) {
	const name = url.searchParams.get('name');
	const result = getFilePath(name);
	if (result.error) return new Response(result.error, { status: 400 });

	try {
		const buffer = fs.readFileSync(result.path);
		const ext = path.extname(name).toLowerCase();
		const contentType = MIME[ext] || 'application/octet-stream';
		return new Response(buffer, {
			headers: {
				'Content-Type': contentType,
				'Content-Length': buffer.length.toString(),
				'Cache-Control': 'no-cache',
			},
		});
	} catch {
		return new Response('File not found', { status: 404 });
	}
}

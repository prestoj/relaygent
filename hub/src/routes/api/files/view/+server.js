import fs from 'fs';
import path from 'path';
import { getFilePath } from '$lib/files.js';

const MIME = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
	'.pdf': 'application/pdf',
	'.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
	'.py': 'text/plain; charset=utf-8', '.js': 'text/plain; charset=utf-8',
	'.sh': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8',
	'.yml': 'text/plain; charset=utf-8', '.toml': 'text/plain; charset=utf-8',
};

const STREAMABLE = new Set(['.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg']);

/** GET /api/files/view?name=filename — serve file inline with proper Content-Type */
export function GET({ url, request }) {
	const name = url.searchParams.get('name');
	const result = getFilePath(name);
	if (result.error) return new Response(result.error, { status: 400 });

	try {
		const stat = fs.statSync(result.path);
		const ext = path.extname(name).toLowerCase();
		const contentType = MIME[ext] || 'application/octet-stream';
		const size = stat.size;

		// Range request support (required for Safari video/audio playback)
		const range = request.headers.get('range');
		if (range && STREAMABLE.has(ext)) {
			const match = range.match(/bytes=(\d+)-(\d*)/);
			const start = parseInt(match[1], 10);
			const end = match[2] ? parseInt(match[2], 10) : Math.min(start + 1024 * 1024, size - 1);
			const stream = fs.createReadStream(result.path, { start, end });
			return new Response(stream, {
				status: 206,
				headers: {
					'Content-Type': contentType, 'Content-Length': (end - start + 1).toString(),
					'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes',
				},
			});
		}

		const buffer = fs.readFileSync(result.path);
		const headers = { 'Content-Type': contentType, 'Content-Length': size.toString(), 'Cache-Control': 'no-cache' };
		if (STREAMABLE.has(ext)) headers['Accept-Ranges'] = 'bytes';
		return new Response(buffer, { headers });
	} catch {
		return new Response('File not found', { status: 404 });
	}
}

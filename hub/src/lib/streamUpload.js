/**
 * Streaming file upload handler — bypasses SvelteKit body parser.
 * Pipes request body directly to disk for unlimited file size support.
 */
import fs from 'fs';
import path from 'path';
import { getSharedDir, validateFilename, MAX_FILE_SIZE } from './files.js';

export function handleStreamUpload(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	const name = url.searchParams.get('name');
	const err = validateFilename(name);
	if (err) return respond(res, 400, { error: err });

	const dest = path.join(getSharedDir(), name);
	if (!dest.startsWith(getSharedDir())) return respond(res, 400, { error: 'Invalid path' });

	const ws = fs.createWriteStream(dest);
	let bytes = 0;
	let aborted = false;

	// Enforce MAX_FILE_SIZE on the stream: this raw handler bypasses SvelteKit's
	// BODY_SIZE_LIMIT, so without this an unbounded upload could fill the disk.
	req.on('data', (chunk) => {
		bytes += chunk.length;
		if (bytes > MAX_FILE_SIZE && !aborted) {
			aborted = true;
			req.unpipe(ws);
			ws.destroy();
			try { fs.unlinkSync(dest); } catch {}
			respond(res, 413, { error: `File exceeds ${MAX_FILE_SIZE}-byte limit` });
			req.destroy();
		}
	});
	req.pipe(ws);

	ws.on('finish', () => {
		if (aborted) return;
		const stat = fs.statSync(dest);
		respond(res, 201, { name, size: stat.size, modified: stat.mtime.toISOString() });
	});

	ws.on('error', (e) => {
		if (aborted) return;
		try { fs.unlinkSync(dest); } catch {}
		respond(res, 500, { error: e.message || 'Upload failed' });
	});

	req.on('error', (e) => {
		if (aborted) return;
		ws.destroy();
		try { fs.unlinkSync(dest); } catch {}
		respond(res, 500, { error: e.message || 'Upload failed' });
	});
}

function respond(res, status, body) {
	if (res.headersSent) return;
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

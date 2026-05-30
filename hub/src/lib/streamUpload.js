/**
 * Streaming file upload handler — bypasses SvelteKit body parser.
 * Pipes request body directly to disk for unlimited file size support.
 */
import fs from 'fs';
import path from 'path';
import { safeResolve, validatePath, MAX_FILE_SIZE } from './files.js';

export function handleStreamUpload(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	// `name` may be a subpath (e.g. "docs/report.pdf") so uploads can target folders.
	const name = url.searchParams.get('name');
	const err = validatePath(name);
	if (err) return respond(res, 400, { error: err });

	const resolved = safeResolve(name);
	if (resolved.error) return respond(res, 400, { error: resolved.error });
	const dest = resolved.path;
	try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch {}

	const ws = fs.createWriteStream(dest);
	let bytes = 0;
	let aborted = false;
	let succeeded = false;

	// Remove the file once the write stream is fully closed, unless the upload
	// completed successfully. Cleaning up on 'close' — rather than with an inline
	// unlinkSync at abort/error time — fixes a race: createWriteStream opens the
	// file asynchronously, so if the abort fires before the open completes, an
	// inline unlink no-ops (ENOENT) and the open then leaves a 0-byte orphan.
	// 'close' always fires after the fd is resolved, so cleanup is reliable.
	ws.on('close', () => {
		if (succeeded) return;
		try { fs.unlinkSync(dest); } catch {}
	});

	// Enforce MAX_FILE_SIZE on the stream: this raw handler bypasses SvelteKit's
	// BODY_SIZE_LIMIT, so without this an unbounded upload could fill the disk.
	req.on('data', (chunk) => {
		bytes += chunk.length;
		if (bytes > MAX_FILE_SIZE && !aborted) {
			aborted = true;
			req.unpipe(ws);
			ws.destroy();
			respond(res, 413, { error: `File exceeds ${MAX_FILE_SIZE}-byte limit` });
			req.destroy();
		}
	});
	req.pipe(ws);

	ws.on('finish', () => {
		if (aborted) return;
		const stat = fs.statSync(dest);
		succeeded = true;
		respond(res, 201, {
			name: path.basename(name), path: name,
			size: stat.size, modified: stat.mtime.toISOString(), isDir: false,
		});
	});

	ws.on('error', (e) => {
		if (aborted) return;
		respond(res, 500, { error: e.message || 'Upload failed' });
	});

	req.on('error', (e) => {
		if (aborted) return;
		ws.destroy();
		respond(res, 500, { error: e.message || 'Upload failed' });
	});
}

function respond(res, status, body) {
	if (res.headersSent) return;
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

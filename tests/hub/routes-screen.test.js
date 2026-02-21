/**
 * Tests for GET /api/screen route handler.
 *
 * Strategy:
 *  - Start a fake Hammerspoon HTTP server on a random port before importing the module
 *    (HAMMERSPOON_URL is baked in at module load time, so HAMMERSPOON_PORT must be set first)
 *  - Fake server writes files to SCREENSHOT_PATH on each request, controlled via flags
 *  - Fake `sips` binary in PATH so execSync doesn't call the real sips
 *
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-screen.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCREENSHOT_PATH = '/tmp/claude-screenshot.png';
const SCALED_PATH = '/tmp/claude-screenshot-scaled.png';
const MAX_BYTES = 5 * 1024 * 1024;
const FAKE_PNG = Buffer.from('fake-png-content');

// Build a minimal fake PNG header with a given width (bytes 16-19 big-endian).
function fakePngHeader(width, totalSize) {
	const buf = Buffer.alloc(totalSize || 24, 0);
	buf.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0); // PNG sig
	buf.writeUInt32BE(13, 8); // IHDR length
	buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
	buf.writeUInt32BE(width, 16); // width
	buf.writeUInt32BE(720, 20); // height
	return buf;
}

// --- Fake sips + convert CLIs (prepend to PATH before module import) ---
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-sips-'));
const sipsBin = path.join(binDir, 'sips');
fs.writeFileSync(sipsBin, [
	'#!/bin/bash',
	'prev=""; out=""',
	'for arg in "$@"; do',
	'  if [ "$prev" = "--out" ]; then out="$arg"; fi',
	'  prev="$arg"',
	'done',
	'if [ -n "$out" ]; then printf "SCALED" > "$out"; fi',
].join('\n'), { mode: 0o755 });
// Fake convert (ImageMagick) — output file is last arg
const convertBin = path.join(binDir, 'convert');
fs.writeFileSync(convertBin, '#!/bin/bash\nprintf "SCALED" > "${@: -1}"', { mode: 0o755 });
process.env.PATH = binDir + path.delimiter + process.env.PATH;

// --- Fake Hammerspoon server ---
let fileToWrite = null; // null = don't write, Buffer = write this content

const fakeHs = http.createServer((_req, res) => {
	if (fileToWrite !== null) {
		fs.writeFileSync(SCREENSHOT_PATH, fileToWrite);
	}
	res.writeHead(200);
	res.end();
});
await new Promise(r => fakeHs.listen(0, '127.0.0.1', r));
const hsPort = fakeHs.address().port;
process.env.HAMMERSPOON_PORT = String(hsPort);

// Import AFTER env vars are set (HAMMERSPOON_URL is a module-level constant)
const { GET } = await import('../../hub/src/routes/api/screen/+server.js');

// Cleanup helper
function clearScreenshots() {
	for (const p of [SCREENSHOT_PATH, SCALED_PATH]) {
		try { fs.unlinkSync(p); } catch { /* ok if missing */ }
	}
}

// --- Tests ---

test('GET /api/screen: returns PNG bytes and correct headers on success', async () => {
	clearScreenshots();
	fileToWrite = FAKE_PNG;
	const res = await GET();
	fileToWrite = null;

	assert.equal(res.status, 200);
	assert.equal(res.headers.get('Content-Type'), 'image/png');
	assert.equal(res.headers.get('Cache-Control'), 'no-cache, no-store');
	const body = Buffer.from(await res.arrayBuffer());
	assert.ok(body.equals(FAKE_PNG), 'response body should match screenshot file');
});

test('GET /api/screen: wide image triggers scaling (sips on mac, convert on linux)', async () => {
	clearScreenshots();
	fileToWrite = fakePngHeader(2560, 1024); // 2560px wide — exceeds MAX_WIDTH
	const res = await GET();
	fileToWrite = null;

	assert.equal(res.status, 200);
	assert.equal(res.headers.get('Content-Type'), 'image/png');
	assert.ok(fs.existsSync(SCALED_PATH), 'sips should have created scaled file');
	const body = Buffer.from(await res.arrayBuffer());
	assert.ok(body.toString().includes('SCALED'), 'body should be sips output');
});

test('GET /api/screen: returns 502 when Hammerspoon is unreachable', async () => {
	clearScreenshots();
	// Close server so fetch throws "connection refused"
	await new Promise(r => fakeHs.close(r));
	const res = await GET();

	assert.equal(res.status, 502);
	assert.deepEqual(await res.json(), { error: 'screenshot failed' });
});

/**
 * Tests for hub/src/lib/streamUpload.js — streaming file upload handler.
 * Uses a fake HTTP server to exercise handleStreamUpload directly.
 * Run: node --test tests/hub/streamUpload.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Setup: temp data dir + import ───────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-upload-test-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

const { handleStreamUpload } = await import(
	'../../hub/src/lib/streamUpload.js?t=' + Date.now()
);

const sharedDir = path.join(tmpDir, 'shared');

// ── Fake HTTP server wrapping handleStreamUpload ────────────────────────────

const server = http.createServer((req, res) => handleStreamUpload(req, res));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

after(() => {
	server.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function upload(name, body) {
	const url = name != null ? `${BASE}/?name=${encodeURIComponent(name)}` : BASE;
	return new Promise((resolve, reject) => {
		const req = http.request(url, { method: 'POST' }, (res) => {
			let data = '';
			res.on('data', c => { data += c; });
			res.on('end', () => {
				resolve({ status: res.statusCode, body: JSON.parse(data) });
			});
		});
		req.on('error', reject);
		if (body != null) req.write(body);
		req.end();
	});
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('successful upload: writes file and returns 201 with metadata', async () => {
	const content = 'hello world streaming upload';
	const res = await upload('test-upload.txt', content);
	assert.equal(res.status, 201);
	assert.equal(res.body.name, 'test-upload.txt');
	assert.equal(res.body.size, Buffer.byteLength(content));
	assert.ok(res.body.modified, 'should include modified timestamp');
	// Verify file on disk
	const filePath = path.join(sharedDir, 'test-upload.txt');
	assert.ok(fs.existsSync(filePath));
	assert.equal(fs.readFileSync(filePath, 'utf8'), content);
});

test('successful upload: handles binary data', async () => {
	const buf = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x42]);
	const res = await upload('binary.bin', buf);
	assert.equal(res.status, 201);
	assert.equal(res.body.size, 5);
	const written = fs.readFileSync(path.join(sharedDir, 'binary.bin'));
	assert.deepEqual(written, buf);
});

test('successful upload: handles empty body', async () => {
	const res = await upload('empty.txt', '');
	assert.equal(res.status, 201);
	assert.equal(res.body.size, 0);
});

test('missing filename: returns 400', async () => {
	const res = await upload(null, 'data');
	assert.equal(res.status, 400);
	assert.ok(res.body.error);
});

test('empty filename: returns 400', async () => {
	const res = await upload('', 'data');
	assert.equal(res.status, 400);
	assert.ok(res.body.error);
});

test('invalid filename with path traversal: returns 400', async () => {
	const res = await upload('../etc/passwd', 'evil');
	assert.equal(res.status, 400);
	assert.ok(res.body.error);
});

test('invalid filename with slash: returns 400', async () => {
	const res = await upload('sub/file.txt', 'data');
	assert.equal(res.status, 400);
	assert.ok(res.body.error);
});

test('hidden filename: returns 400', async () => {
	const res = await upload('.env', 'SECRET=x');
	assert.equal(res.status, 400);
	assert.ok(res.body.error);
});

test('request error: cleans up partial file', async () => {
	const name = 'aborted-upload.txt';
	await new Promise((resolve) => {
		const req = http.request(`${BASE}/?name=${name}`, { method: 'POST' });
		req.on('error', () => {}); // suppress client-side ECONNRESET
		req.write('partial data');
		req.socket?.destroy() ?? req.on('socket', (s) => s.destroy());
		setTimeout(resolve, 200);
	});
	const filePath = path.join(sharedDir, name);
	assert.ok(!fs.existsSync(filePath), 'partial file should be cleaned up');
});

test('overwrite existing file', async () => {
	await upload('overwrite.txt', 'version 1');
	const res = await upload('overwrite.txt', 'version 2');
	assert.equal(res.status, 201);
	const content = fs.readFileSync(path.join(sharedDir, 'overwrite.txt'), 'utf8');
	assert.equal(content, 'version 2');
});

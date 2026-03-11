/**
 * Tests for /api/files/download and /api/files/view endpoints.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/files-download-view.test.js
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-dl-view-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

// Create shared dir with test files
const sharedDir = path.join(tmpDir, 'shared');
fs.mkdirSync(sharedDir, { recursive: true });
fs.writeFileSync(path.join(sharedDir, 'hello.txt'), 'Hello world');
fs.writeFileSync(path.join(sharedDir, 'data.json'), '{"key":"value"}');
fs.writeFileSync(path.join(sharedDir, 'notes.md'), '# Notes\nSome content');
fs.writeFileSync(path.join(sharedDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const { GET: download } = await import('../../hub/src/routes/api/files/download/+server.js');
const { GET: view } = await import('../../hub/src/routes/api/files/view/+server.js');

function makeUrl(endpoint, params = {}, headers = {}) {
	const u = new URL(`http://localhost/api/files/${endpoint}`);
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u, request: { headers: new Headers(headers) } };
}

// --- Download endpoint ---

test('download: returns 400 for missing name', async () => {
	const res = download(makeUrl('download'));
	assert.equal(res.status, 400);
});

test('download: returns 400 for path traversal', async () => {
	const res = download(makeUrl('download', { name: '../etc/passwd' }));
	assert.equal(res.status, 400);
});

test('download: returns 404 for non-existent file', async () => {
	const res = download(makeUrl('download', { name: 'nope.txt' }));
	assert.equal(res.status, 404);
});

test('download: returns file with attachment disposition', async () => {
	const res = download(makeUrl('download', { name: 'hello.txt' }));
	assert.equal(res.status, 200);
	assert.ok(res.headers.get('content-disposition').includes('attachment'));
	assert.ok(res.headers.get('content-disposition').includes('hello.txt'));
	assert.equal(res.headers.get('content-type'), 'application/octet-stream');
	const body = await res.text();
	assert.equal(body, 'Hello world');
});

test('download: content-length matches file size', async () => {
	const res = download(makeUrl('download', { name: 'hello.txt' }));
	assert.equal(res.headers.get('content-length'), '11');
});

// --- View endpoint ---

test('view: returns 400 for missing name', async () => {
	const res = view(makeUrl('view'));
	assert.equal(res.status, 400);
});

test('view: returns 400 for hidden file', async () => {
	const res = view(makeUrl('view', { name: '.env' }));
	assert.equal(res.status, 400);
});

test('view: returns 404 for non-existent file', async () => {
	const res = view(makeUrl('view', { name: 'missing.txt' }));
	assert.equal(res.status, 404);
});

test('view: serves text file with correct mime', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }));
	assert.equal(res.status, 200);
	assert.ok(res.headers.get('content-type').includes('text/plain'));
	const body = await res.text();
	assert.equal(body, 'Hello world');
});

test('view: serves JSON with correct mime', async () => {
	const res = view(makeUrl('view', { name: 'data.json' }));
	assert.equal(res.status, 200);
	assert.ok(res.headers.get('content-type').includes('application/json'));
});

test('view: serves markdown with correct mime', async () => {
	const res = view(makeUrl('view', { name: 'notes.md' }));
	assert.equal(res.status, 200);
	assert.ok(res.headers.get('content-type').includes('text/markdown'));
});

test('view: serves PNG with image mime', async () => {
	const res = view(makeUrl('view', { name: 'image.png' }));
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'image/png');
});

test('view: sets no-cache header', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }));
	assert.equal(res.headers.get('cache-control'), 'no-cache');
});

test('view: unknown extension falls back to octet-stream', async () => {
	fs.writeFileSync(path.join(sharedDir, 'data.xyz'), 'unknown');
	const res = view(makeUrl('view', { name: 'data.xyz' }));
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'application/octet-stream');
});

// --- Range request tests ---

test('view: advertises Accept-Ranges', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }));
	assert.equal(res.headers.get('accept-ranges'), 'bytes');
});

test('view: range request returns 206 with correct bytes', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }, { range: 'bytes=0-4' }));
	assert.equal(res.status, 206);
	assert.equal(res.headers.get('content-range'), 'bytes 0-4/11');
	assert.equal(res.headers.get('content-length'), '5');
	const body = await res.text();
	assert.equal(body, 'Hello');
});

test('view: range request middle of file', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }, { range: 'bytes=6-10' }));
	assert.equal(res.status, 206);
	const body = await res.text();
	assert.equal(body, 'world');
});

test('view: open-ended range returns rest of file', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }, { range: 'bytes=6-' }));
	assert.equal(res.status, 206);
	assert.equal(res.headers.get('content-range'), 'bytes 6-10/11');
	const body = await res.text();
	assert.equal(body, 'world');
});

test('view: range past end returns 416', async () => {
	const res = view(makeUrl('view', { name: 'hello.txt' }, { range: 'bytes=100-' }));
	assert.equal(res.status, 416);
	assert.ok(res.headers.get('content-range').includes('*/11'));
});

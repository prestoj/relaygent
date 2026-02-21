/**
 * Tests for GET /api/files (list) and DELETE /api/files (remove) route handlers.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-files-crud.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-crud-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

const sharedDir = path.join(tmpDir, 'shared');
fs.mkdirSync(sharedDir, { recursive: true });

const { GET, DELETE: DEL } = await import('../../hub/src/routes/api/files/+server.js');

function makeUrl(endpoint, params = {}) {
	const u = new URL(`http://localhost/api/files${endpoint}`);
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

// --- GET /api/files (list) ---

test('GET: returns empty array when no files', async () => {
	const res = GET();
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.ok(Array.isArray(data.files));
	assert.equal(data.files.length, 0);
});

test('GET: returns files with name, size, modified', async () => {
	fs.writeFileSync(path.join(sharedDir, 'readme.txt'), 'hello world');
	const res = GET();
	const data = await res.json();
	assert.equal(data.files.length, 1);
	const f = data.files[0];
	assert.equal(f.name, 'readme.txt');
	assert.equal(f.size, 11);
	assert.ok(f.modified);
});

test('GET: excludes hidden files', async () => {
	fs.writeFileSync(path.join(sharedDir, '.secret'), 'hidden');
	const res = GET();
	const data = await res.json();
	const names = data.files.map(f => f.name);
	assert.ok(!names.includes('.secret'));
});

test('GET: excludes directories', async () => {
	fs.mkdirSync(path.join(sharedDir, 'subdir'), { recursive: true });
	const res = GET();
	const data = await res.json();
	const names = data.files.map(f => f.name);
	assert.ok(!names.includes('subdir'));
});

test('GET: lists multiple files', async () => {
	fs.writeFileSync(path.join(sharedDir, 'a.txt'), 'aaa');
	fs.writeFileSync(path.join(sharedDir, 'b.json'), '{}');
	const res = GET();
	const data = await res.json();
	const names = data.files.map(f => f.name);
	assert.ok(names.includes('a.txt'));
	assert.ok(names.includes('b.json'));
});

// --- DELETE /api/files ---

test('DELETE: returns 400 for missing name', async () => {
	const res = await DEL(makeUrl(''));
	assert.equal(res.status, 400);
	const data = await res.json();
	assert.ok(data.error);
});

test('DELETE: returns 400 for empty name', async () => {
	const res = await DEL(makeUrl('', { name: '' }));
	assert.equal(res.status, 400);
});

test('DELETE: returns 400 for path traversal', async () => {
	const res = await DEL(makeUrl('', { name: '../etc/passwd' }));
	assert.equal(res.status, 400);
});

test('DELETE: returns 400 for hidden file', async () => {
	const res = await DEL(makeUrl('', { name: '.env' }));
	assert.equal(res.status, 400);
});

test('DELETE: returns 404 for non-existent file', async () => {
	const res = await DEL(makeUrl('', { name: 'nonexistent.txt' }));
	assert.equal(res.status, 404);
	const data = await res.json();
	assert.ok(data.error.includes('not found'));
});

test('DELETE: successfully deletes existing file', async () => {
	const target = path.join(sharedDir, 'to-delete.txt');
	fs.writeFileSync(target, 'delete me');
	assert.ok(fs.existsSync(target));

	const res = await DEL(makeUrl('', { name: 'to-delete.txt' }));
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.equal(data.ok, true);
	assert.ok(!fs.existsSync(target));
});

test('DELETE: file no longer appears in GET after deletion', async () => {
	fs.writeFileSync(path.join(sharedDir, 'temp.txt'), 'temporary');
	let data = await GET().json();
	assert.ok(data.files.some(f => f.name === 'temp.txt'));

	await DEL(makeUrl('', { name: 'temp.txt' }));
	data = await GET().json();
	assert.ok(!data.files.some(f => f.name === 'temp.txt'));
});

test('DELETE: returns 400 for filename with invalid chars', async () => {
	const res = await DEL(makeUrl('', { name: 'file<script>.txt' }));
	assert.equal(res.status, 400);
});

// Cleanup
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

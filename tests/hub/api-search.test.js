/**
 * Tests for /api/search endpoint (+server.js).
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-search.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'api-search-'));
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-search-home-'));
process.env.RELAYGENT_KB_DIR = tmpKb;
process.env.HOME = tmpHome;

// Write a test topic before importing
fs.writeFileSync(path.join(tmpKb, 'testing.md'), '---\ntitle: Testing Guide\n---\nHow to test things');

const { GET } = await import('../../hub/src/routes/api/search/+server.js');

after(() => {
	fs.rmSync(tmpKb, { recursive: true, force: true });
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

function fakeReq(params = {}) {
	const sp = new URLSearchParams(params);
	return { url: new URL(`http://localhost/api/search?${sp}`) };
}

test('api search: short query returns empty', async () => {
	const res = await GET(fakeReq({ q: 'a' }));
	const data = await res.json();
	assert.deepEqual(data.results, []);
});

test('api search: finds KB topics', async () => {
	const res = await GET(fakeReq({ q: 'testing' }));
	const data = await res.json();
	assert.ok(data.results.length >= 1);
	assert.ok(data.results[0].title.includes('Testing'));
});

test('api search: default returns max 8 results', async () => {
	const res = await GET(fakeReq({ q: 'testing' }));
	const data = await res.json();
	assert.ok(data.results.length <= 8);
});

test('api search: full=1 includes type field', async () => {
	const res = await GET(fakeReq({ q: 'testing', full: '1' }));
	const data = await res.json();
	assert.ok(data.results.length >= 1);
	assert.equal(data.results[0].type, 'topic');
});

test('api search: results include snippet field with full=1', async () => {
	const res = await GET(fakeReq({ q: 'testing', full: '1' }));
	const data = await res.json();
	assert.ok('snippet' in data.results[0]);
});

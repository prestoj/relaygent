/**
 * Tests for /api/summary — session summary endpoint (validation paths).
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-summary.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
process.env.HOME = tmpHome;
process.env.RELAYGENT_DATA_DIR = path.join(tmpHome, 'data');

const { GET } = await import('../../hub/src/routes/api/summary/+server.js');

function makeUrl(params = {}) {
	const u = new URL('http://localhost/api/summary');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

test('returns 400 for invalid session ID format', async () => {
	const res = await GET(makeUrl({ session: 'bad-format' }));
	assert.equal(res.status, 400);
	const data = await res.json();
	assert.ok(data.error.includes('Invalid'));
});

test('returns 400 for partial session ID', async () => {
	const res = await GET(makeUrl({ session: '2026-02-21' }));
	assert.equal(res.status, 400);
});

test('returns 400 for session ID with extra chars', async () => {
	const res = await GET(makeUrl({ session: '2026-02-21-10-00-00-extra' }));
	assert.equal(res.status, 400);
});

test('returns 404 for non-existent session', async () => {
	const res = await GET(makeUrl({ session: '2099-01-01-00-00-00' }));
	assert.equal(res.status, 404);
	const data = await res.json();
	assert.ok(data.error.includes('not found'));
});

test('current session returns null summary when no session exists', async () => {
	const res = await GET(makeUrl({ session: 'current' }));
	const data = await res.json();
	assert.equal(data.summary, null);
});

test('defaults to current when no session param provided', async () => {
	const res = await GET(makeUrl());
	const data = await res.json();
	// No active session in test env, so summary is null
	assert.equal(data.summary, null);
});

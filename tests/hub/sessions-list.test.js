/**
 * Tests for /api/sessions — session list API.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/sessions-list.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Set up fake session directories before importing
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-list-'));
const sessions = [
	{ id: '2026-02-20-10-00-00', text: 'First session' },
	{ id: '2026-02-21-14-30-00', text: 'Second session' },
];

for (const s of sessions) {
	const dir = path.join(tmpHome, '.claude', 'projects', `-fake-${s.id}`);
	fs.mkdirSync(dir, { recursive: true });
	const data = [
		{ type: 'assistant', message: { content: [{ type: 'text', text: s.text }] }, timestamp: `${s.id.slice(0, 10)}T${s.id.slice(11).replace(/-/g, ':')}Z` },
		{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'tu1', input: { file_path: '/tmp/x' } }] }, timestamp: `${s.id.slice(0, 10)}T${s.id.slice(11).replace(/-/g, ':')}Z` },
		{ type: 'result', tool_use_id: 'tu1', content: 'ok' },
	];
	fs.writeFileSync(path.join(dir, 'abcd1234.jsonl'), data.map(d => JSON.stringify(d)).join('\n') + '\n');
}

process.env.HOME = tmpHome;

const { GET } = await import('../../hub/src/routes/api/sessions/+server.js');

function makeUrl(params = {}) {
	const u = new URL('http://localhost/api/sessions');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

test('returns JSON with sessions array', async () => {
	const res = await GET(makeUrl());
	assert.equal(res.status, 200);
	const body = JSON.parse(await res.text());
	assert.ok(Array.isArray(body.sessions));
	assert.equal(body.total, 2);
});

test('sessions have expected fields', async () => {
	const res = await GET(makeUrl());
	const { sessions } = JSON.parse(await res.text());
	const s = sessions[0];
	assert.ok('id' in s, 'has id');
	assert.ok('time' in s, 'has time');
	assert.ok('durationMin' in s, 'has durationMin');
	assert.ok('tokens' in s, 'has tokens');
	assert.ok('tools' in s, 'has tools');
	assert.ok('summary' in s, 'has summary');
});

test('respects limit parameter', async () => {
	const res = await GET(makeUrl({ limit: '1' }));
	const body = JSON.parse(await res.text());
	assert.equal(body.sessions.length, 1);
	assert.equal(body.total, 2);
	assert.equal(body.hasMore, true);
});

test('respects offset parameter', async () => {
	const res = await GET(makeUrl({ offset: '1', limit: '10' }));
	const body = JSON.parse(await res.text());
	assert.equal(body.sessions.length, 1);
	assert.equal(body.offset, 1);
});

test('returns empty when offset exceeds total', async () => {
	const res = await GET(makeUrl({ offset: '100' }));
	const body = JSON.parse(await res.text());
	assert.equal(body.sessions.length, 0);
	assert.equal(body.hasMore, false);
});

test('limit is capped at 100', async () => {
	const res = await GET(makeUrl({ limit: '999' }));
	const body = JSON.parse(await res.text());
	assert.equal(body.limit, 100);
});

test('stats is null when no summary file exists', async () => {
	const res = await GET(makeUrl());
	const { sessions } = JSON.parse(await res.text());
	for (const s of sessions) assert.equal(s.stats, null);
});

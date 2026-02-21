/**
 * Tests for /api/sessions/export — session markdown export.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/session-export.test.js
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Set up a fake session directory before importing
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-export-'));
const sessionId = '2026-02-21-10-00-00';
const projectDir = path.join(tmpHome, '.claude', 'projects', `-fake-${sessionId}`);
fs.mkdirSync(projectDir, { recursive: true });

const sessionData = [
	{ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] }, timestamp: '2026-02-21T10:00:01Z' },
	{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'tu1', input: { file_path: '/tmp/test.txt' } }] }, timestamp: '2026-02-21T10:00:05Z' },
	{ type: 'result', tool_use_id: 'tu1', content: 'file contents here' },
	{ type: 'assistant', message: { content: [{ type: 'text', text: 'Done reading' }] }, timestamp: '2026-02-21T10:00:10Z' },
];
fs.writeFileSync(path.join(projectDir, 'session.jsonl'), sessionData.map(d => JSON.stringify(d)).join('\n'));

process.env.HOME = tmpHome;

const { GET } = await import('../../hub/src/routes/api/sessions/export/+server.js');

function makeUrl(params = {}) {
	const u = new URL('http://localhost/api/sessions/export');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

test('returns 400 for missing id', async () => {
	const res = await GET(makeUrl());
	assert.equal(res.status, 400);
});

test('returns 400 for invalid id format', async () => {
	const res = await GET(makeUrl({ id: 'bad-id' }));
	assert.equal(res.status, 400);
});

test('returns 404 for non-existent session', async () => {
	const res = await GET(makeUrl({ id: '2099-01-01-00-00-00' }));
	assert.equal(res.status, 404);
});

test('returns markdown for valid session', async () => {
	const res = await GET(makeUrl({ id: sessionId }));
	assert.equal(res.status, 200);
	assert.ok(res.headers.get('content-type').includes('text/markdown'));
	assert.ok(res.headers.get('content-disposition').includes('session-'));
	const body = await res.text();
	assert.ok(body.includes('# Session'));
	assert.ok(body.includes('Activity'));
});

test('markdown contains activity section', async () => {
	const res = await GET(makeUrl({ id: sessionId }));
	const body = await res.text();
	assert.ok(body.includes('## Activity'));
	assert.ok(body.includes('`Read`'));
});

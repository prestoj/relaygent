/**
 * Tests for /api/chat route handlers (GET, POST, PATCH).
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-chat.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-route-test-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

const { GET, POST, PATCH } = await import('../src/routes/api/chat/+server.js');

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function postReq(body) {
	return { request: new Request('http://localhost/', { method: 'POST',
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
function patchReq(body) {
	return { request: new Request('http://localhost/', { method: 'PATCH',
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
function getReq(params = {}) {
	const u = new URL('http://localhost/api/chat');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

// GET
test('GET /api/chat returns messages array', async () => {
	const res = GET(getReq());
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.messages));
});

test('GET /api/chat?mode=unread returns count and messages', async () => {
	const res = GET(getReq({ mode: 'unread' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(typeof body.count === 'number');
	assert.ok(Array.isArray(body.messages));
});

test('GET /api/chat respects limit param', async () => {
	const body = await GET(getReq({ limit: '2' })).json();
	assert.ok(body.messages.length <= 2);
});

// POST
test('POST /api/chat: empty content returns 400', async () => {
	const res = await POST(postReq({ content: '   ' }));
	assert.equal(res.status, 400);
	assert.ok((await res.json()).error);
});

test('POST /api/chat: missing content returns 400', async () => {
	const res = await POST(postReq({}));
	assert.equal(res.status, 400);
});

test('POST /api/chat: content over 10000 chars returns 400', async () => {
	const res = await POST(postReq({ content: 'x'.repeat(10001) }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /exceeds/);
});

test('POST /api/chat: invalid JSON returns 400', async () => {
	const res = await POST({ request: new Request('http://localhost/', {
		method: 'POST', body: 'not-json' }) });
	assert.equal(res.status, 400);
});

test('POST /api/chat: valid human message returns 201', async () => {
	const res = await POST(postReq({ content: 'Hello from test' }));
	assert.equal(res.status, 201);
	const body = await res.json();
	assert.equal(body.content, 'Hello from test');
	assert.equal(body.role, 'human');
	assert.ok(body.id > 0);
});

test('POST /api/chat: role=assistant stores as assistant', async () => {
	const res = await POST(postReq({ content: 'Agent reply', role: 'assistant' }));
	assert.equal(res.status, 201);
	assert.equal((await res.json()).role, 'assistant');
});

test('POST /api/chat: content is trimmed', async () => {
	const res = await POST(postReq({ content: '  padded  ' }));
	assert.equal(res.status, 201);
	assert.equal((await res.json()).content, 'padded');
});

// PATCH
test('PATCH /api/chat: missing ids returns 400', async () => {
	assert.equal((await PATCH(patchReq({}))).status, 400);
});

test('PATCH /api/chat: empty ids array returns 400', async () => {
	assert.equal((await PATCH(patchReq({ ids: [] }))).status, 400);
});

test('PATCH /api/chat: non-array ids returns 400', async () => {
	assert.equal((await PATCH(patchReq({ ids: 'bad' }))).status, 400);
});

test('PATCH /api/chat: invalid JSON returns 400', async () => {
	const res = await PATCH({ request: new Request('http://localhost/', {
		method: 'PATCH', body: '{bad' }) });
	assert.equal(res.status, 400);
});

test('PATCH /api/chat: valid ids returns ok:true', async () => {
	const msg = await (await POST(postReq({ content: 'Mark me read' }))).json();
	const res = await PATCH(patchReq({ ids: [msg.id] }));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
});

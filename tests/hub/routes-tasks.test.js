/**
 * Tests for /api/tasks route handlers (GET, POST, PATCH, PUT, DELETE).
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-tasks.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-route-test-'));
process.env.RELAYGENT_KB_DIR = tmpDir;

const { GET, POST, PATCH, PUT, DELETE } = await import('../../hub/src/routes/api/tasks/+server.js');

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeTasks(content) {
	fs.writeFileSync(path.join(tmpDir, 'tasks.md'), content, 'utf-8');
}
function readTasks() {
	return fs.readFileSync(path.join(tmpDir, 'tasks.md'), 'utf-8');
}
function jsonReq(body, method = 'POST') {
	return { request: new Request('http://localhost/', {
		method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}

before(() => writeTasks('updated: 2026-01-01\n'));

// --- GET ---
test('GET /api/tasks: returns recurring and oneoff arrays', async () => {
	writeTasks('- [ ] Do thing | type: one-off\n- [ ] Commit KB | type: recurring | freq: daily | last: never\n');
	const res = GET();
	assert.equal(res.status, 200);
	const { recurring, oneoff } = await res.json();
	assert.equal(recurring.length, 1);
	assert.equal(oneoff.length, 1);
	assert.equal(recurring[0].description, 'Commit KB');
	assert.equal(oneoff[0].description, 'Do thing');
});

test('GET /api/tasks: returns empty arrays when no tasks file', async () => {
	fs.rmSync(path.join(tmpDir, 'tasks.md'), { force: true });
	const res = GET();
	const body = await res.json();
	assert.deepEqual(body.recurring, []);
	assert.deepEqual(body.oneoff, []);
	writeTasks('updated: 2026-01-01\n');
});

test('GET /api/tasks: recurring tasks sorted by due first', async () => {
	const old = new Date(Date.now() - 48 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
	const recent = new Date(Date.now() - 1000).toISOString().slice(0, 16).replace('T', ' ');
	writeTasks(
		`- [ ] B task | type: recurring | freq: daily | last: ${recent}\n` +
		`- [ ] A task | type: recurring | freq: daily | last: ${old}\n`
	);
	const { recurring } = await (await GET()).json();
	assert.equal(recurring[0].description, 'A task'); // overdue comes first
});

// --- POST ---
test('POST /api/tasks: adds a one-off task', async () => {
	writeTasks('updated: 2026-01-01\n');
	const res = await POST(jsonReq({ description: 'Fix the bug' }));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
	assert.ok(readTasks().includes('Fix the bug'));
});

test('POST /api/tasks: rejects empty description', async () => {
	const res = await POST(jsonReq({ description: '   ' }));
	assert.equal(res.status, 400);
});

test('POST /api/tasks: rejects missing description', async () => {
	const res = await POST(jsonReq({}));
	assert.equal(res.status, 400);
});

test('POST /api/tasks: adds a recurring task with valid freq', async () => {
	writeTasks('updated: 2026-01-01\n');
	const res = await POST(jsonReq({ description: 'Commit KB', freq: 'daily' }));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
	assert.ok(readTasks().includes('Commit KB'));
});

test('POST /api/tasks: rejects invalid freq', async () => {
	const res = await POST(jsonReq({ description: 'Do thing', freq: 'hourly' }));
	assert.equal(res.status, 400);
});

test('POST /api/tasks: returns 500 on bad request body', async () => {
	const res = await POST({ request: new Request('http://localhost/', { method: 'POST', body: 'not-json', headers: { 'Content-Type': 'application/json' } }) });
	assert.equal(res.status, 500);
});

test('PATCH /api/tasks: returns 500 on bad request body', async () => {
	const res = await PATCH({ request: new Request('http://localhost/', { method: 'PATCH', body: 'not-json', headers: { 'Content-Type': 'application/json' } }) });
	assert.equal(res.status, 500);
});

test('PUT /api/tasks: returns 500 on bad request body', async () => {
	const res = await PUT({ request: new Request('http://localhost/', { method: 'PUT', body: 'not-json', headers: { 'Content-Type': 'application/json' } }) });
	assert.equal(res.status, 500);
});

test('DELETE /api/tasks: returns 500 on bad request body', async () => {
	const res = await DELETE({ request: new Request('http://localhost/', { method: 'DELETE', body: 'not-json', headers: { 'Content-Type': 'application/json' } }) });
	assert.equal(res.status, 500);
});

// --- PATCH ---
test('PATCH /api/tasks: renames a task', async () => {
	writeTasks('- [ ] Old name | type: one-off\nupdated: 2026-01-01\n');
	const res = await PATCH(jsonReq({ oldDescription: 'Old name', newDescription: 'New name' }, 'PATCH'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
	const raw = readTasks();
	assert.ok(raw.includes('New name'));
	assert.ok(!raw.includes('Old name'));
});

test('PATCH /api/tasks: returns ok:false for nonexistent task', async () => {
	writeTasks('- [ ] Something | type: one-off\nupdated: 2026-01-01\n');
	const res = await PATCH(jsonReq({ oldDescription: 'Nope', newDescription: 'Whatever' }, 'PATCH'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, false);
});

test('PATCH /api/tasks: rejects missing fields', async () => {
	const res = await PATCH(jsonReq({ oldDescription: 'x' }, 'PATCH'));
	assert.equal(res.status, 400);
});

// --- PUT (complete recurring) ---
test('PUT /api/tasks: updates last timestamp on recurring task', async () => {
	writeTasks('- [ ] Commit KB | type: recurring | freq: daily | last: never\nupdated: 2026-01-01\n');
	const res = await PUT(jsonReq({ description: 'Commit KB' }, 'PUT'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
	assert.ok(!readTasks().includes('last: never'));
});

test('PUT /api/tasks: returns ok:false for nonexistent task', async () => {
	writeTasks('- [ ] Commit KB | type: recurring | freq: daily | last: never\nupdated: 2026-01-01\n');
	const res = await PUT(jsonReq({ description: 'No such task' }, 'PUT'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, false);
});

test('PUT /api/tasks: rejects missing description', async () => {
	const res = await PUT(jsonReq({}, 'PUT'));
	assert.equal(res.status, 400);
});

// --- DELETE ---
test('DELETE /api/tasks: removes a one-off task', async () => {
	writeTasks('- [ ] Remove me | type: one-off\nupdated: 2026-01-01\n');
	const res = await DELETE(jsonReq({ description: 'Remove me' }, 'DELETE'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
	assert.ok(!readTasks().includes('Remove me'));
});

test('DELETE /api/tasks: removes a recurring task', async () => {
	writeTasks('- [ ] Commit KB | type: recurring | freq: daily | last: never\nupdated: 2026-01-01\n');
	const res = await DELETE(jsonReq({ description: 'Commit KB' }, 'DELETE'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
	assert.ok(!readTasks().includes('Commit KB'));
});

test('DELETE /api/tasks: rejects missing description', async () => {
	const res = await DELETE(jsonReq({}, 'DELETE'));
	assert.equal(res.status, 400);
});

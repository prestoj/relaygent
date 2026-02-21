/**
 * Tests for /api/health, /api/logs, /api/notifications route handlers.
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-misc.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';

// Point logs route at a temp dir so tests don't depend on real log files
const TMP_LOGS = fs.mkdtempSync(os.tmpdir() + '/hub-logs-test-');
process.env.RELAYGENT_LOGS_DIR = TMP_LOGS;
// Use a port that is guaranteed to have nothing listening (notifications service unreachable)
process.env.RELAYGENT_NOTIFICATIONS_PORT = '19999';

const { GET: healthGet } = await import('../../hub/src/routes/api/health/+server.js');
const { GET: logsGet } = await import('../../hub/src/routes/api/logs/+server.js');
const { GET: notifGet, POST: notifPost, DELETE: notifDelete } =
	await import('../../hub/src/routes/api/notifications/+server.js');

function urlReq(pathname, params = {}) {
	const u = new URL('http://localhost' + pathname);
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}
function postReq(body) {
	return { request: new Request('http://localhost/', { method: 'POST',
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}

// --- Health ---
test('GET /api/health returns {status: ok}', async () => {
	const res = healthGet();
	assert.equal(res.status, 200);
	assert.equal((await res.json()).status, 'ok');
});

// --- Logs ---
test('GET /api/logs: unknown file throws 400', async () => {
	try {
		await logsGet(urlReq('/api/logs', { file: 'evil' }));
		assert.fail('should have thrown');
	} catch (e) {
		assert.equal(e.status, 400);
	}
});

test('GET /api/logs: path traversal blocked', async () => {
	try {
		await logsGet(urlReq('/api/logs', { file: '../etc/passwd' }));
		assert.fail('should have thrown');
	} catch (e) {
		assert.equal(e.status, 400);
	}
});

test('GET /api/logs: valid file returns file and lines keys', async () => {
	const res = await logsGet(urlReq('/api/logs', { file: 'relaygent' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.file, 'relaygent');
	assert.ok('lines' in body || 'error' in body);
});

test('GET /api/logs: defaults to relaygent when file omitted', async () => {
	const res = await logsGet(urlReq('/api/logs'));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).file, 'relaygent');
});

// --- Notifications ---
test('POST /api/notifications: missing trigger_time returns 400', async () => {
	const res = await notifPost(postReq({ message: 'hello' }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /trigger_time/);
});

test('POST /api/notifications: missing message returns 400', async () => {
	const res = await notifPost(postReq({ trigger_time: '2026-01-01T00:00:00' }));
	assert.equal(res.status, 400);
});

test('POST /api/notifications: invalid JSON returns 400', async () => {
	const res = await notifPost({ request: new Request('http://localhost/', {
		method: 'POST', body: 'bad' }) });
	assert.equal(res.status, 400);
});

test('DELETE /api/notifications: non-numeric id returns 400', async () => {
	const res = await notifDelete(urlReq('/api/notifications', { id: 'abc' }));
	assert.equal(res.status, 400);
});

test('DELETE /api/notifications: missing id returns 400', async () => {
	const res = await notifDelete(urlReq('/api/notifications'));
	assert.equal(res.status, 400);
});

test('GET /api/notifications: unreachable service returns empty reminders', async () => {
	const res = await notifGet();
	assert.equal(res.status, 200);
	assert.ok(Array.isArray((await res.json()).reminders));
});

test('POST /api/notifications: unreachable service returns 502', async () => {
	const res = await notifPost(postReq({ trigger_time: '2026-06-01T09:00:00', message: 'hello' }));
	assert.equal(res.status, 502);
	assert.match((await res.json()).error, /unreachable/i);
});

test('DELETE /api/notifications: unreachable service returns 502', async () => {
	const res = await notifDelete(urlReq('/api/notifications', { id: '1' }));
	assert.equal(res.status, 502);
	assert.match((await res.json()).error, /unreachable/i);
});

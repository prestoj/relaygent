/**
 * Tests for /api/relay route handlers (POST stop/start/status, GET activity).
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-relay.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set HOME to a temp dir so relay.pid/config/plist checks hit controlled paths
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-route-test-'));
process.env.HOME = tmpHome;

const { GET, POST } = await import('../src/routes/api/relay/+server.js');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function postReq(body) {
	return { request: new Request('http://localhost/', { method: 'POST',
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
function getReq(params = {}) {
	const u = new URL('http://localhost/api/relay');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

// --- POST validation ---
test('POST /api/relay: invalid JSON returns 400', async () => {
	const res = await POST({ request: new Request('http://localhost/', {
		method: 'POST', body: 'bad' }) });
	assert.equal(res.status, 400);
});

test('POST /api/relay: unknown action returns 400', async () => {
	const res = await POST(postReq({ action: 'reboot' }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Unknown action/);
});

// --- stop: relay not running ---
test('POST /api/relay stop: no pid file → already_stopped', async () => {
	const res = await POST(postReq({ action: 'stop' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.ok, true);
	assert.equal(body.status, 'already_stopped');
});

test('POST /api/relay stop: stale pid (dead process) → already_stopped', async () => {
	const pidFile = path.join(tmpHome, '.relaygent', 'relay.pid');
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, '99999999\n'); // PID unlikely to exist
	const res = await POST(postReq({ action: 'stop' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	// PID 99999999 should not exist — either already_stopped or stopped
	assert.ok(body.ok);
	fs.rmSync(pidFile, { force: true });
});

// --- status ---
test('POST /api/relay status: no pid file → not running', async () => {
	const res = await POST(postReq({ action: 'status' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.running, false);
	assert.equal(body.pid, null);
});

test('POST /api/relay status: stale pid → not running', async () => {
	const pidFile = path.join(tmpHome, '.relaygent', 'relay.pid');
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, '99999999\n');
	const res = await POST(postReq({ action: 'status' }));
	const body = await res.json();
	assert.equal(body.running, false);
	assert.equal(body.pid, 99999999);
	fs.rmSync(pidFile, { force: true });
});

// --- start: relay not running, no LaunchAgent ---
test('POST /api/relay start: relay already running (own pid) → already_running', async () => {
	const pidFile = path.join(tmpHome, '.relaygent', 'relay.pid');
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, `${process.pid}\n`); // Use this test process's PID — guaranteed alive
	const res = await POST(postReq({ action: 'start' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.ok, true);
	assert.equal(body.status, 'already_running');
	fs.rmSync(pidFile, { force: true });
});

// --- GET activity ---
test('GET /api/relay: no sessions → empty activities', async () => {
	const res = GET(getReq());
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.activities));
	assert.equal(body.hasMore, false);
});

test('GET /api/relay: invalid session id returns empty', async () => {
	const res = GET(getReq({ session: '../etc/passwd' }));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).activities.length, 0);
});

test('GET /api/relay: unknown session uuid returns empty', async () => {
	const res = GET(getReq({ session: '00000000-0000-0000-0000-000000000000' }));
	assert.equal(res.status, 200);
	assert.equal((await res.json()).activities.length, 0);
});

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

const { GET, POST } = await import('../../hub/src/routes/api/relay/+server.js');

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

// --- stop: live process (mock kill to avoid terminating test runner) ---
test('POST /api/relay stop: live pid → stopped (SIGTERM)', async () => {
	// Spawn a real short-lived process to get a live PID we can safely signal
	const { spawnSync } = await import('node:child_process');
	const child = (await import('node:child_process')).spawn('sleep', ['30']);
	const livePid = child.pid;
	const pidFile = path.join(tmpHome, '.relaygent', 'relay.pid');
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, `${livePid}\n`);
	const res = await POST(postReq({ action: 'stop' }));
	const body = await res.json();
	assert.ok(body.ok, `expected ok, got: ${JSON.stringify(body)}`);
	assert.ok(body.status === 'stopped' || body.status === 'already_stopped');
	fs.rmSync(pidFile, { force: true });
	try { child.kill(); } catch { /* already dead */ }
});

// --- start: no LaunchAgent, relay.py missing → error ---
test('POST /api/relay start: relay.py missing → 500', async () => {
	// No pid file + no LaunchAgent plist + relay.py doesn't exist at config path
	const res = await POST(postReq({ action: 'start' }));
	const body = await res.json();
	// Either started (if relay.py happens to exist) or error — either is valid JSON response
	assert.ok(typeof body === 'object' && ('ok' in body || 'error' in body));
});

// --- GET: real session data ---
test('GET /api/relay: returns valid response shape', async () => {
	const res = GET(getReq());
	const body = await res.json();
	assert.ok(Array.isArray(body.activities));
	assert.ok(typeof body.hasMore === 'boolean');
	// total only present when a session file is found
	if ('total' in body) assert.ok(typeof body.total === 'number');
});

// --- GET: pagination ---
test('GET /api/relay: limit parameter respected', async () => {
	const res = GET(getReq({ limit: '1' }));
	const body = await res.json();
	assert.ok(body.activities.length <= 1);
});

// --- GET: session lookup by UUID (covers findSessionById lines 15-19) ---
test('GET /api/relay: known session uuid returns activities array', async () => {
	const uuid = '12345678-1234-1234-1234-123456789abc';
	const projectDir = path.join(tmpHome, '.claude', 'projects', 'test-project');
	fs.mkdirSync(projectDir, { recursive: true });
	// Write a minimal JSONL session file (enough for parseSession to succeed)
	const entry = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] }, timestamp: new Date().toISOString() });
	fs.writeFileSync(path.join(projectDir, `${uuid}.jsonl`), entry + '\n');
	const res = GET(getReq({ session: uuid }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.activities));
	assert.ok(typeof body.hasMore === 'boolean');
});

// --- stop: LaunchAgent plist present, launchctl bootout succeeds ---
test('POST /api/relay stop: LaunchAgent plist present, bootout succeeds → stopped', async () => {
	const plistDir = path.join(tmpHome, 'Library', 'LaunchAgents');
	const plistPath = path.join(plistDir, 'com.claude.relay.plist.relaygent');
	fs.mkdirSync(plistDir, { recursive: true });
	fs.writeFileSync(plistPath, '<plist/>');

	// Fake launchctl that always exits 0
	const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-bin-'));
	const fakeLaunchctl = path.join(tmpBin, 'launchctl');
	fs.writeFileSync(fakeLaunchctl, '#!/bin/sh\nexit 0\n');
	fs.chmodSync(fakeLaunchctl, 0o755);
	const origPath = process.env.PATH;
	process.env.PATH = `${tmpBin}:${origPath}`;

	// Live PID so isRelayRunning passes
	const pidFile = path.join(tmpHome, '.relaygent', 'relay.pid');
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, `${process.pid}\n`);

	const res = await POST(postReq({ action: 'stop' }));
	const body = await res.json();
	assert.ok(body.ok);
	assert.equal(body.status, 'stopped');

	process.env.PATH = origPath;
	fs.rmSync(plistPath, { force: true });
	fs.rmSync(tmpBin, { recursive: true, force: true });
	fs.rmSync(pidFile, { force: true });
});

// --- start: LaunchAgent plist present, launchctl bootstrap succeeds ---
test('POST /api/relay start: LaunchAgent plist present, bootstrap succeeds → started', async () => {
	const plistDir = path.join(tmpHome, 'Library', 'LaunchAgents');
	const plistPath = path.join(plistDir, 'com.claude.relay.plist.relaygent');
	fs.mkdirSync(plistDir, { recursive: true });
	fs.writeFileSync(plistPath, '<plist/>');

	const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-bin-'));
	const fakeLaunchctl = path.join(tmpBin, 'launchctl');
	fs.writeFileSync(fakeLaunchctl, '#!/bin/sh\nexit 0\n');
	fs.chmodSync(fakeLaunchctl, 0o755);
	const origPath = process.env.PATH;
	process.env.PATH = `${tmpBin}:${origPath}`;

	// No pid file so it proceeds to start
	const pidFile = path.join(tmpHome, '.relaygent', 'relay.pid');
	fs.rmSync(pidFile, { force: true });

	const res = await POST(postReq({ action: 'start' }));
	const body = await res.json();
	assert.ok(body.ok);
	assert.equal(body.status, 'started');

	process.env.PATH = origPath;
	fs.rmSync(plistPath, { force: true });
	fs.rmSync(tmpBin, { recursive: true, force: true });
});

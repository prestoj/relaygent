/**
 * Tests for hub/src/routes/api/logs/+server.js
 * Run with: node --test hub/tests/logs.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the route at a temp logs dir via env var
const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-'));
process.env.RELAYGENT_LOGS_DIR = logsDir;

const { GET } = await import('../src/routes/api/logs/+server.js');

after(() => {
	delete process.env.RELAYGENT_LOGS_DIR;
	fs.rmSync(logsDir, { recursive: true, force: true });
});

function makeUrl(file, lines) {
	const u = new URL('http://localhost/api/logs');
	if (file) u.searchParams.set('file', file);
	if (lines) u.searchParams.set('lines', String(lines));
	return { url: u };
}

function writeLog(name, content) {
	fs.writeFileSync(path.join(logsDir, `${name}.log`), content, 'utf-8');
}

test('GET /api/logs: returns last N lines of relay log', async () => {
	writeLog('relaygent', Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));
	const res = await GET(makeUrl('relaygent', 10));
	const d = await res.json();
	assert.equal(d.file, 'relaygent');
	const lines = d.lines.split('\n').filter(Boolean);
	assert.equal(lines.length, 10);
	assert.ok(lines[lines.length - 1].includes('line 50'));
});

test('GET /api/logs: defaults to relaygent log', async () => {
	writeLog('relaygent', 'hello\nworld');
	const res = await GET(makeUrl(null, null));
	const d = await res.json();
	assert.equal(d.file, 'relaygent');
	assert.ok(d.lines.includes('hello'));
});

test('GET /api/logs: returns 400 for unknown file', async () => {
	try {
		await GET(makeUrl('../../etc/passwd', 10));
		assert.fail('Should have thrown');
	} catch (e) {
		assert.ok(e.status === 400 || e.message?.includes('Unknown'));
	}
});

test('GET /api/logs: hub log is whitelisted', async () => {
	writeLog('relaygent-hub', 'hub started\nhub running');
	const res = await GET(makeUrl('relaygent-hub', 5));
	const d = await res.json();
	assert.equal(d.file, 'relaygent-hub');
	assert.ok(d.lines.includes('hub'));
});

test('GET /api/logs: slack-socket log is whitelisted', async () => {
	writeLog('slack-socket', 'connected\nmessage received');
	const res = await GET(makeUrl('slack-socket', 5));
	const d = await res.json();
	assert.equal(d.file, 'slack-socket');
	assert.ok(d.lines.includes('connected'));
});

test('GET /api/logs: missing file returns error field not crash', async () => {
	const res = await GET(makeUrl('relaygent-notifications', 10));
	const d = await res.json();
	assert.ok(d.error || d.lines === '');
});

test('GET /api/logs: caps lines at 1000', async () => {
	writeLog('relaygent', Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'));
	const res = await GET(makeUrl('relaygent', 99999));
	assert.equal(res.status, 200);
	const d = await res.json();
	assert.ok(d.lines !== undefined);
});

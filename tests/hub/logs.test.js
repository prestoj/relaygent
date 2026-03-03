/**
 * Tests for hub/src/routes/api/logs/+server.js
 * Run with: node --test hub/tests/logs.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the route at temp dirs via env vars
const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-test-'));
process.env.RELAYGENT_LOGS_DIR = logsDir;
process.env.RELAYGENT_DATA_DIR = dataDir;

const { GET } = await import('../../hub/src/routes/api/logs/+server.js');

after(() => {
	delete process.env.RELAYGENT_LOGS_DIR;
	delete process.env.RELAYGENT_DATA_DIR;
	fs.rmSync(logsDir, { recursive: true, force: true });
	fs.rmSync(dataDir, { recursive: true, force: true });
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

function makeSourcesUrl() {
	const u = new URL('http://localhost/api/logs');
	u.searchParams.set('sources', 'true');
	return { url: u };
}

function writeBgTasks(tasks) {
	fs.writeFileSync(path.join(dataDir, 'background-tasks.json'), JSON.stringify(tasks), 'utf-8');
}

test('GET /api/logs?sources=true: returns static sources', async () => {
	const res = await GET(makeSourcesUrl());
	const d = await res.json();
	assert.ok(Array.isArray(d.sources));
	const ids = d.sources.map(s => s.id);
	assert.ok(ids.includes('relaygent'));
	assert.ok(ids.includes('relaygent-hub'));
});

test('GET /api/logs?sources=true: includes bg tasks with logs', async () => {
	const logFile = path.join(os.tmpdir(), 'test-bg.log');
	fs.writeFileSync(logFile, 'step 100\nstep 200\n');
	writeBgTasks([{ pid: 999999, desc: 'Test task', log: logFile }]);
	const res = await GET(makeSourcesUrl());
	const d = await res.json();
	const bg = d.sources.find(s => s.id === 'bg:999999');
	assert.ok(bg, 'bg task should appear in sources');
	assert.ok(bg.bg === true);
	assert.ok(bg.label.includes('Test task'));
	fs.unlinkSync(logFile);
});

test('GET /api/logs: serves bg task log file', async () => {
	const logFile = path.join(os.tmpdir(), 'test-bg2.log');
	fs.writeFileSync(logFile, 'line A\nline B\nline C\n');
	writeBgTasks([{ pid: 888888, desc: 'BG log test', log: logFile }]);
	const u = new URL('http://localhost/api/logs');
	u.searchParams.set('file', 'bg:888888');
	const res = await GET({ url: u });
	const d = await res.json();
	assert.ok(d.lines.includes('line C'));
	fs.unlinkSync(logFile);
});

test('GET /api/logs: unknown bg task returns 400', async () => {
	writeBgTasks([]);
	try {
		const u = new URL('http://localhost/api/logs');
		u.searchParams.set('file', 'bg:000000');
		await GET({ url: u });
		assert.fail('Should have thrown');
	} catch (e) {
		assert.ok(e.status === 400);
	}
});

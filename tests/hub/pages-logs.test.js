/**
 * Tests for the logs page loader (logs/+page.server.js).
 * Tests tailFile behavior with various log file states.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-logs.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The module computes LOGS_DIR = HOME/projects/relaygent/logs at load time
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-home-'));
const logsDir = path.join(tmpHome, 'projects', 'relaygent', 'logs');
const logFile = path.join(logsDir, 'relaygent.log');
fs.mkdirSync(logsDir, { recursive: true });
process.env.HOME = tmpHome;

const { load } = await import('../../hub/src/routes/logs/+page.server.js');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

test('logs load returns expected keys', async () => {
	const data = await load();
	assert.ok('initialLines' in data);
});

test('logs load: returns string content', async () => {
	const data = await load();
	assert.equal(typeof data.initialLines, 'string');
});

test('logs load: reads log file content', async () => {
	fs.writeFileSync(logFile, 'line1\nline2\nline3\n');
	const data = await load();
	assert.ok(data.initialLines.includes('line1'));
	assert.ok(data.initialLines.includes('line3'));
});

test('logs load: handles missing log file gracefully', async () => {
	try { fs.unlinkSync(logFile); } catch { /* ok */ }
	const data = await load();
	assert.equal(data.initialLines, '');
});

test('logs load: tails last N lines of large file', async () => {
	const lines = Array.from({ length: 500 }, (_, i) => `log-entry-${i}`);
	fs.writeFileSync(logFile, lines.join('\n') + '\n');
	const data = await load();
	// Default is 200 lines — should contain the last entries
	assert.ok(data.initialLines.includes('log-entry-499'));
	assert.ok(data.initialLines.includes('log-entry-350'));
	// Should NOT contain very early entries
	assert.ok(!data.initialLines.includes('log-entry-0\n'));
});

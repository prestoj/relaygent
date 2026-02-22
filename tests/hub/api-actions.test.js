/**
 * Tests for /api/actions — run whitelisted relaygent commands.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-actions.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'actions-test-'));
process.env.HOME = tmpHome;

// Create a fake relaygent binary that echoes back the command
const binDir = path.join(tmpHome, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const fakeBin = path.join(binDir, 'relaygent');
process.env.RELAYGENT_BIN = fakeBin;
fs.writeFileSync(fakeBin, '#!/bin/bash\necho "ran: $*"');
fs.chmodSync(fakeBin, 0o755);

const { GET, POST } = await import('../../hub/src/routes/api/actions/+server.js');

function makeRequest(body) {
	return { request: { json: async () => body } };
}

test('GET /api/actions returns list of available actions', async () => {
	const res = GET();
	const data = await res.json();
	assert.ok(Array.isArray(data.actions));
	assert.ok(data.actions.includes('health'));
	assert.ok(data.actions.includes('check'));
	assert.ok(data.actions.includes('status'));
	assert.ok(data.actions.includes('digest'));
	assert.ok(data.actions.includes('clean-logs'));
});

test('POST with valid action runs command and returns output', async () => {
	const res = await POST(makeRequest({ action: 'health' }));
	const data = await res.json();
	assert.ok(data.output.includes('ran: health'));
	assert.ok(typeof data.ms === 'number');
});

test('POST with unknown action returns 400', async () => {
	const res = await POST(makeRequest({ action: 'rm-rf' }));
	assert.equal(res.status, 400);
	const data = await res.json();
	assert.ok(data.error.includes('Unknown'));
});

test('POST with empty action returns 400', async () => {
	const res = await POST(makeRequest({ action: '' }));
	assert.equal(res.status, 400);
});

test('clean-logs action passes --dry-run flag', async () => {
	const res = await POST(makeRequest({ action: 'clean-logs' }));
	const data = await res.json();
	assert.ok(data.output.includes('ran: clean-logs --dry-run'));
});

test('ANSI codes are stripped from output', async () => {
	// Update fake binary to emit ANSI
	fs.writeFileSync(fakeBin, '#!/bin/bash\necho -e "\\033[0;32mgreen\\033[0m text"');
	fs.chmodSync(fakeBin, 0o755);
	const res = await POST(makeRequest({ action: 'status' }));
	const data = await res.json();
	assert.ok(!data.output.includes('\x1b'));
	assert.ok(data.output.includes('green'));
});

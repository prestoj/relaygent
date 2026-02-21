/**
 * Tests for POST /api/kb — commit KB endpoint
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-api-kb.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set up: KB dir inside a parent so commit.sh sits alongside it (not in /tmp directly)
const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-api-test-'));
const tmpKbDir = path.join(tmpParent, 'kb');
fs.mkdirSync(tmpKbDir);
process.env.RELAYGENT_KB_DIR = tmpKbDir;

const { POST } = await import('../../hub/src/routes/api/kb/+server.js');
const commitScript = path.join(tmpParent, 'commit.sh');

after(() => { fs.rmSync(tmpParent, { recursive: true, force: true }); });

test('POST /api/kb: 404 when commit.sh not found', async () => {
	if (fs.existsSync(commitScript)) fs.unlinkSync(commitScript);
	const res = await POST();
	assert.equal(res.status, 404);
	const body = await res.json();
	assert.equal(body.ok, false);
	assert.match(body.error, /commit\.sh/);
});

test('POST /api/kb: 200 when commit.sh exits 0', async () => {
	fs.writeFileSync(commitScript, '#!/bin/bash\nexit 0\n');
	fs.chmodSync(commitScript, 0o755);
	const res = await POST();
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);
});

test('POST /api/kb: 500 when commit.sh exits non-zero', async () => {
	fs.writeFileSync(commitScript, '#!/bin/bash\nexit 1\n');
	fs.chmodSync(commitScript, 0o755);
	const res = await POST();
	assert.equal(res.status, 500);
	assert.equal((await res.json()).ok, false);
});

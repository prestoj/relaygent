/**
 * Tests for sessions page loaders:
 *  - sessions/+page.server.js (list)
 *  - sessions/[id]/+page.server.js (detail)
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-sessions.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-home-'));
process.env.HOME = tmpHome;

// Create a fake .claude/projects workspace with a session JSONL
const wsName = '-fake-workspace-2026-02-20-12-00-00';
const wsDir = path.join(tmpHome, '.claude', 'projects', wsName);
fs.mkdirSync(wsDir, { recursive: true });

// Minimal JSONL that parseSessionStats can read
const fakeJsonl = [
	JSON.stringify({ timestamp: '2026-02-20T12:00:00Z', type: 'assistant', message: { usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'text', text: 'Starting work on the project' }] } }),
	JSON.stringify({ timestamp: '2026-02-20T12:05:00Z', type: 'assistant', message: { usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/test' } }] } }),
].join('\n');
fs.writeFileSync(path.join(wsDir, 'aabb1122-test.jsonl'), fakeJsonl);

// Set RELAYGENT_RUNS_PREFIX so listSessions finds our workspace
process.env.RELAYGENT_RUNS_PREFIX = '-fake-workspace';

const listMod = await import('../../hub/src/routes/sessions/+page.server.js');
const detailMod = await import('../../hub/src/routes/sessions/[id]/+page.server.js');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

// --- Sessions list ---

test('sessions list load returns expected keys', () => {
	const data = listMod.load();
	assert.ok('sessions' in data);
	assert.ok('stats' in data);
});

test('sessions list: sessions is an array', () => {
	const data = listMod.load();
	assert.ok(Array.isArray(data.sessions));
});

test('sessions list: finds our fake session', () => {
	const data = listMod.load();
	assert.ok(data.sessions.length >= 1, 'should find at least one session');
	const sess = data.sessions.find(s => s.id === '2026-02-20-12-00-00--aabb1122');
	assert.ok(sess, 'should find session by ID');
});

test('sessions list: session has expected fields', () => {
	const data = listMod.load();
	const sess = data.sessions[0];
	assert.ok(sess.id, 'should have id');
	assert.ok(sess.displayTime, 'should have displayTime');
	assert.ok('size' in sess, 'should have size');
});

test('sessions list: stats object has expected fields', () => {
	const data = listMod.load();
	if (data.stats) {
		assert.ok('totalSessions' in data.stats);
		assert.ok('totalTokens' in data.stats);
	}
});

// --- Session detail ---

test('session detail: valid ID returns session data', () => {
	const data = detailMod.load({ params: { id: '2026-02-20-12-00-00' } });
	assert.equal(data.id, '2026-02-20-12-00-00');
	assert.ok(data.displayTime);
	assert.ok(Array.isArray(data.activity));
});

test('session detail: invalid ID format throws 404', () => {
	try {
		detailMod.load({ params: { id: 'not-a-valid-id' } });
		assert.fail('should have thrown');
	} catch (e) {
		assert.equal(e.status, 404);
	}
});

test('session detail: nonexistent session throws 404', () => {
	try {
		detailMod.load({ params: { id: '9999-01-01-00-00-00' } });
		assert.fail('should have thrown');
	} catch (e) {
		assert.equal(e.status, 404);
	}
});

test('session detail: displayTime is formatted correctly', () => {
	const data = detailMod.load({ params: { id: '2026-02-20-12-00-00' } });
	assert.equal(data.displayTime, '2026-02-20 12:00');
});

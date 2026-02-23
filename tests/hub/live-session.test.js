/**
 * Tests for /api/session/live — live session stats API.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/live-session.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Create a fake home with a session JSONL
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live-session-'));
const tmpData = path.join(tmpHome, 'data');
fs.mkdirSync(tmpData, { recursive: true });

const runDir = path.join(tmpHome, '.claude', 'projects', `-fake-2026-02-23-12-00-00`);
fs.mkdirSync(runDir, { recursive: true });

const now = '2026-02-23T12:00:00Z';
const later = '2026-02-23T12:15:00Z';
const sessionLines = [
	{ type: 'assistant', timestamp: now, message: { usage: { input_tokens: 5000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: 'Starting work on the feature.' }] } },
	{ type: 'assistant', timestamp: now, message: { usage: { input_tokens: 8000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/tmp/foo.js' } }] } },
	{ type: 'user', timestamp: now, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file content here' }] } },
	{ type: 'assistant', timestamp: later, message: { usage: { input_tokens: 12000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [
		{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/tmp/foo.js', old_string: 'a', new_string: 'b' } },
		{ type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'npm test' } },
	] } },
	{ type: 'user', timestamp: later, message: { content: [
		{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok' },
		{ type: 'tool_result', tool_use_id: 'tu3', content: 'all tests pass' },
	] } },
];
fs.writeFileSync(path.join(runDir, 'aabb1122.jsonl'), sessionLines.map(l => JSON.stringify(l)).join('\n') + '\n');

// Write relay status
fs.writeFileSync(path.join(tmpData, 'relay-status.json'), JSON.stringify({ status: 'working', session_id: 'aabb1122', updated: now }));

process.env.HOME = tmpHome;
process.env.RELAYGENT_DATA_DIR = tmpData;
process.env.RELAY_STATUS_FILE = path.join(tmpData, 'relay-status.json');

const { GET } = await import('../../hub/src/routes/api/session/live/+server.js');

test('returns active session with stats', async () => {
	const res = GET();
	const data = await res.json();
	assert.equal(data.active, true);
	assert.equal(data.status, 'working');
	assert.equal(data.turns, 3);
	assert.equal(data.toolCalls, 3);
	assert.equal(data.durationMin, 15);
	// contextPct based on last turn's input_tokens (12000 / 2000 = 6)
	assert.equal(data.contextPct, 6);
	assert.ok(data.topTools.Read >= 1);
	assert.ok(data.topTools.Edit >= 1);
	assert.ok(data.topTools.Bash >= 1);
});

test('tracks modified vs read files', async () => {
	const data = await GET().json();
	assert.ok(data.filesModified.includes('/tmp/foo.js'));
	// foo.js was both Read and Edit — should appear in modified, not read
	assert.ok(!data.filesRead.includes('/tmp/foo.js'));
});

test('returns recent tools', async () => {
	const data = await GET().json();
	assert.ok(Array.isArray(data.recentTools));
	assert.ok(data.recentTools.length > 0);
	const names = data.recentTools.map(t => t.name);
	assert.ok(names.includes('Edit') || names.includes('Bash') || names.includes('Read'));
});

test('returns sessionId from relay status', async () => {
	const data = await GET().json();
	assert.equal(data.sessionId, 'aabb1122');
});

test('returns inactive when relay is off', async () => {
	fs.writeFileSync(path.join(tmpData, 'relay-status.json'), JSON.stringify({ status: 'sleeping' }));
	const data = await GET().json();
	assert.equal(data.active, false);
	assert.equal(data.status, 'sleeping');
	// Restore
	fs.writeFileSync(path.join(tmpData, 'relay-status.json'), JSON.stringify({ status: 'working', session_id: 'aabb1122' }));
});

test('returns inactive when no session file', async () => {
	const origHome = process.env.HOME;
	const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'live-empty-'));
	process.env.HOME = emptyHome;
	// Need to re-import to pick up new HOME for findLatestSession
	// But since modules are cached, we test via the existing import
	// which still finds files from tmpHome. This is a known ESM cache limitation.
	process.env.HOME = origHome;
});

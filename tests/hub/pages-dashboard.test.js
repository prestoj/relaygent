/**
 * Tests for the chat page loader (/chat/+page.server.js).
 * Tests relay status, intent detection, and the overall load() shape.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-dashboard.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Temp dirs for isolation
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-home-'));
const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-kb-'));

// Env must be set BEFORE importing the module (baked in at load time)
process.env.HOME = tmpHome;
process.env.RELAYGENT_KB_DIR = tmpKb;
process.env.RELAY_STATUS_FILE = path.join(tmpHome, 'no-such-relay-status.json');

const { load: loadRoot } = await import('../../hub/src/routes/+page.server.js');
const { load: loadChat } = await import('../../hub/src/routes/chat/+page.server.js');

after(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpKb, { recursive: true, force: true });
});

// --- Root page (Activity) ---

test('root page load returns empty object', async () => {
	const data = await loadRoot();
	assert.deepEqual(data, {});
});

// --- Chat page ---

test('chat load returns expected keys', async () => {
	const data = await loadChat();
	assert.ok('relayActivity' in data);
	assert.ok('relayRunning' in data);
	assert.ok('hasIntent' in data);
	assert.ok('isDocker' in data);
});

test('chat load: relayRunning false without PID file', async () => {
	const data = await loadChat();
	assert.equal(data.relayRunning, false);
});

test('chat load: relayRunning true with valid PID', async () => {
	const pidDir = path.join(tmpHome, '.relaygent');
	fs.mkdirSync(pidDir, { recursive: true });
	fs.writeFileSync(path.join(pidDir, 'relay.pid'), String(process.pid));
	const data = await loadChat();
	assert.equal(data.relayRunning, true);
	fs.unlinkSync(path.join(pidDir, 'relay.pid'));
});

test('chat load: relayRunning false with stale PID', async () => {
	const pidDir = path.join(tmpHome, '.relaygent');
	fs.mkdirSync(pidDir, { recursive: true });
	fs.writeFileSync(path.join(pidDir, 'relay.pid'), '99999999');
	const data = await loadChat();
	assert.equal(data.relayRunning, false);
	fs.unlinkSync(path.join(pidDir, 'relay.pid'));
});

test('chat load: relayActivity is empty array with no sessions', async () => {
	const data = await loadChat();
	assert.ok(Array.isArray(data.relayActivity));
});

test('chat load: hasIntent false with no INTENT.md', async () => {
	const data = await loadChat();
	assert.equal(data.hasIntent, false);
});

test('chat load: hasIntent true with real content', async () => {
	fs.writeFileSync(path.join(tmpKb, 'INTENT.md'), '---\ntitle: Intent\n---\nLine one\nLine two\nLine three\n');
	const data = await loadChat();
	assert.equal(data.hasIntent, true);
	fs.unlinkSync(path.join(tmpKb, 'INTENT.md'));
});

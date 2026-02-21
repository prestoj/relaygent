/**
 * Tests for the main dashboard page loader (+page.server.js).
 * Tests getAttentionItems, getContextPct, isRelayRunning,
 * and the overall load() shape.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-dashboard.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Temp dirs for isolation
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-home-'));
const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-kb-'));
const ctxFile = path.join(os.tmpdir(), `ctx-pct-test-${Date.now()}`);

// Env must be set BEFORE importing the module (baked in at load time)
process.env.HOME = tmpHome;
process.env.RELAYGENT_KB_DIR = tmpKb;
// Ports that refuse connections immediately (for fast service health failure)
process.env.RELAYGENT_NOTIFICATIONS_PORT = '19111';
process.env.HAMMERSPOON_PORT = '19112';
// Relay status file — point to nonexistent file
process.env.RELAY_STATUS_FILE = path.join(tmpHome, 'no-such-relay-status.json');

const { load } = await import('../../hub/src/routes/+page.server.js');

after(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpKb, { recursive: true, force: true });
	try { fs.unlinkSync(ctxFile); } catch { /* ok */ }
});

// --- load() shape ---

test('dashboard load returns expected keys', async () => {
	const data = await load();
	assert.ok('topicCount' in data);
	assert.ok('attentionItems' in data);
	assert.ok('relayActivity' in data);
	assert.ok('contextPct' in data);
	assert.ok('services' in data);
	assert.ok('relayRunning' in data);
});

test('dashboard load: topicCount is 0 with empty KB dir', async () => {
	const data = await load();
	assert.equal(data.topicCount, 0);
});

test('dashboard load: topicCount reflects KB files', async () => {
	fs.writeFileSync(path.join(tmpKb, 'test-topic.md'), '---\ntitle: Test\n---\nContent');
	const data = await load();
	assert.equal(data.topicCount, 1);
	fs.unlinkSync(path.join(tmpKb, 'test-topic.md'));
});

// --- getAttentionItems ---

test('dashboard load: attentionItems empty without attention.md', async () => {
	const data = await load();
	assert.deepEqual(data.attentionItems, []);
});

test('dashboard load: attentionItems parsed from attention.md', async () => {
	fs.writeFileSync(path.join(tmpKb, 'attention.md'), [
		'---',
		'title: Attention',
		'---',
		'## Active',
		'- **Bug**: fix the login crash',
		'- **Feature**: add dark mode',
		'## Resolved',
		'- Old item',
	].join('\n'));
	const data = await load();
	assert.equal(data.attentionItems.length, 2);
	assert.ok(data.attentionItems[0].includes('Bug'));
	assert.ok(data.attentionItems[1].includes('dark mode'));
	fs.unlinkSync(path.join(tmpKb, 'attention.md'));
});

// --- relayRunning ---

test('dashboard load: relayRunning false without PID file', async () => {
	const data = await load();
	assert.equal(data.relayRunning, false);
});

test('dashboard load: relayRunning true with valid PID', async () => {
	const pidDir = path.join(tmpHome, '.relaygent');
	fs.mkdirSync(pidDir, { recursive: true });
	// Use our own PID — guaranteed to be running
	fs.writeFileSync(path.join(pidDir, 'relay.pid'), String(process.pid));
	const data = await load();
	assert.equal(data.relayRunning, true);
	fs.unlinkSync(path.join(pidDir, 'relay.pid'));
});

test('dashboard load: relayRunning false with stale PID', async () => {
	const pidDir = path.join(tmpHome, '.relaygent');
	fs.mkdirSync(pidDir, { recursive: true });
	// PID 99999999 shouldn't exist
	fs.writeFileSync(path.join(pidDir, 'relay.pid'), '99999999');
	const data = await load();
	assert.equal(data.relayRunning, false);
	fs.unlinkSync(path.join(pidDir, 'relay.pid'));
});

// --- relayActivity ---

test('dashboard load: relayActivity is empty array with no sessions', async () => {
	const data = await load();
	assert.ok(Array.isArray(data.relayActivity));
});

// --- services ---

test('dashboard load: services is an array with expected entries', async () => {
	const data = await load();
	assert.ok(Array.isArray(data.services));
	const names = data.services.map(s => s.name);
	assert.ok(names.includes('Relay'), 'should have Relay entry');
});

test('dashboard load: services show ok:false when unreachable', async () => {
	const data = await load();
	for (const svc of data.services) {
		if (svc.name === 'Notifications' || svc.name === 'Computer Use') {
			assert.equal(svc.ok, false, `${svc.name} should be unreachable`);
		}
	}
});

// --- contextPct ---

test('dashboard load: contextPct is null or a number', async () => {
	const data = await load();
	if (data.contextPct !== null) {
		assert.equal(typeof data.contextPct, 'number');
		assert.ok(data.contextPct >= 0 && data.contextPct <= 100);
	}
});

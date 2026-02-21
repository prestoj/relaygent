/**
 * Tests for hub/src/lib/serviceHealth.js
 * Uses Node.js built-in test runner.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let statusFile;
let getServiceHealth;

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svchealth-test-'));
	statusFile = path.join(tmpDir, 'relay-status.json');
	process.env.RELAY_STATUS_FILE = statusFile;
	// Import after setting env so module picks up our paths
	({ getServiceHealth } = await import('../../hub/src/lib/serviceHealth.js'));
});

after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeStatus(status, updatedSecondsAgo = 5) {
	const updated = new Date(Date.now() - updatedSecondsAgo * 1000).toISOString();
	fs.writeFileSync(statusFile, JSON.stringify({ status, updated }));
}

test('relay status: working shows as ok', async () => {
	writeStatus('working', 2);
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.ok(relay, 'Relay service present');
	assert.equal(relay.ok, true);
	assert.ok(relay.detail.startsWith('working'), `detail starts with working: ${relay.detail}`);
});

test('relay status: sleeping shows as ok', async () => {
	writeStatus('sleeping', 2);
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.equal(relay.ok, true);
	assert.ok(relay.detail.startsWith('sleeping'), `detail starts with sleeping: ${relay.detail}`);
});

test('relay status: off shows as not ok', async () => {
	writeStatus('off', 2);
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.equal(relay.ok, false);
	assert.ok(relay.detail.startsWith('off'), `detail starts with off: ${relay.detail}`);
});

test('relay status: crashed shows as not ok', async () => {
	writeStatus('crashed');
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.equal(relay.ok, false);
});

test('relay status: missing file returns off', async () => {
	if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.equal(relay.ok, false);
	assert.equal(relay.detail, 'off');
});

test('relay status: corrupted file returns off', async () => {
	fs.writeFileSync(statusFile, 'not valid json{{{');
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.equal(relay.ok, false);
	assert.equal(relay.detail, 'off');
});

test('relay status: age shown when >= 1 minute old', async () => {
	writeStatus('working', 120); // 2 minutes ago
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.ok(relay.detail.includes('working'), 'status in detail');
	assert.ok(relay.detail.includes('m'), 'age in minutes shown');
	assert.ok(relay.detail.includes('2'), 'approximately 2 minutes');
});

test('relay status: age not shown when < 1 minute old', async () => {
	writeStatus('sleeping', 10); // 10 seconds ago
	const results = await getServiceHealth();
	const relay = results.find(s => s.name === 'Relay');
	assert.equal(relay.detail, 'sleeping', 'no age suffix for recent update');
});

test('returns array with Relay, Notifications, Computer Use', async () => {
	writeStatus('working');
	const results = await getServiceHealth();
	assert.ok(Array.isArray(results));
	const names = results.map(s => s.name);
	assert.ok(names.includes('Relay'));
	assert.ok(names.includes('Notifications'));
	assert.ok(names.includes('Computer Use'));
});

test('Notifications and Computer Use return valid shape', async () => {
	writeStatus('working');
	const results = await getServiceHealth();
	const notif = results.find(s => s.name === 'Notifications');
	const cu = results.find(s => s.name === 'Computer Use');
	// Whether up or down, shape must be valid — no throws
	assert.equal(typeof notif.ok, 'boolean');
	assert.equal(typeof notif.detail, 'string');
	assert.equal(typeof cu.ok, 'boolean');
	assert.equal(typeof cu.detail, 'string');
});

test('Relay is always first in results', async () => {
	writeStatus('working');
	const results = await getServiceHealth();
	assert.equal(results[0].name, 'Relay');
});

test('Disk entry present with valid shape', async () => {
	writeStatus('working');
	const results = await getServiceHealth();
	const disk = results.find(s => s.name.startsWith('Disk'));
	// df -h <homedir> should always succeed in test env
	assert.ok(disk, 'Disk entry should be present');
	assert.ok(/^Disk \d+%$/.test(disk.name), `name should be "Disk XX%": ${disk.name}`);
	assert.equal(typeof disk.ok, 'boolean');
	assert.equal(disk.detail, '');
});

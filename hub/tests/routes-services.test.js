/**
 * Tests for /api/services route handler.
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-services.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set up temp status file before importing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-route-test-'));
const statusFile = path.join(tmpDir, 'relay-status.json');
process.env.RELAY_STATUS_FILE = statusFile;
// Use ports that are guaranteed unreachable for health checks
process.env.RELAYGENT_NOTIFICATIONS_PORT = '19998';
process.env.HAMMERSPOON_PORT = '19997';

function writeStatus(status, agoSec = 5) {
	const updated = new Date(Date.now() - agoSec * 1000).toISOString();
	fs.writeFileSync(statusFile, JSON.stringify({ status, updated }));
}

const { GET } = await import('../src/routes/api/services/+server.js');

test('GET /api/services returns 200 with services array', async () => {
	writeStatus('working');
	const res = await GET();
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.services), 'services is an array');
	assert.ok(body.services.length >= 3, 'at least Relay + Notifications + Computer Use');
});

test('GET /api/services includes Relay status', async () => {
	writeStatus('working', 2);
	const res = await GET();
	const { services } = await res.json();
	const relay = services.find(s => s.name === 'Relay');
	assert.ok(relay, 'Relay present');
	assert.equal(relay.ok, true);
});

test('GET /api/services: Relay off when status file missing', async () => {
	if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
	const res = await GET();
	const { services } = await res.json();
	const relay = services.find(s => s.name === 'Relay');
	assert.equal(relay.ok, false);
	assert.equal(relay.detail, 'off');
});

test('GET /api/services: unreachable services show ok=false', async () => {
	writeStatus('working');
	const res = await GET();
	const { services } = await res.json();
	const notif = services.find(s => s.name === 'Notifications');
	const cu = services.find(s => s.name === 'Computer Use');
	assert.equal(notif.ok, false, 'Notifications unreachable');
	assert.equal(cu.ok, false, 'Computer Use unreachable');
});

test('GET /api/services: each service has name, ok, detail', async () => {
	writeStatus('sleeping');
	const res = await GET();
	const { services } = await res.json();
	for (const svc of services) {
		assert.equal(typeof svc.name, 'string', `${svc.name} has string name`);
		assert.equal(typeof svc.ok, 'boolean', `${svc.name} has boolean ok`);
		assert.equal(typeof svc.detail, 'string', `${svc.name} has string detail`);
	}
});

test('GET /api/services includes Disk entry', async () => {
	writeStatus('working');
	const res = await GET();
	const { services } = await res.json();
	const disk = services.find(s => s.name.startsWith('Disk'));
	assert.ok(disk, 'Disk entry present');
	assert.ok(/^Disk \d+%$/.test(disk.name), `Disk name format: ${disk.name}`);
});

// Clean up
test('cleanup temp dir', () => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

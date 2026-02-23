/**
 * Tests for /api/fleet endpoint.
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-fleet.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'api-fleet-'));
const configDir = path.join(tmpHome, '.relaygent');
fs.mkdirSync(configDir, { recursive: true });
process.env.HOME = tmpHome;
process.env.PORT = '9999';

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function writeConfig(cfg) {
	fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(cfg));
}

test('fleet: returns local machine when no config', async () => {
	// No config file — should still return local
	const { GET } = await import('../../hub/src/routes/api/fleet/+server.js');
	const res = await GET();
	const data = await res.json();
	assert.ok(Array.isArray(data));
	assert.ok(data.length >= 1);
	assert.equal(data[0].local, true);
	assert.ok(data[0].name);
	assert.ok(data[0].url.includes('9999'));
});

test('fleet: includes configured peers', async () => {
	writeConfig({ fleet: [{ name: 'test-peer', url: 'http://192.168.1.99:8080' }] });
	// Re-import to pick up new config (config is read per-request)
	const { GET } = await import('../../hub/src/routes/api/fleet/+server.js');
	const res = await GET();
	const data = await res.json();
	assert.ok(data.length >= 2);
	const peer = data.find(p => p.name === 'test-peer');
	assert.ok(peer);
	assert.equal(peer.local, false);
	assert.equal(peer.url, 'http://192.168.1.99:8080');
});

test('fleet: unreachable peers return null health/session', async () => {
	writeConfig({ fleet: [{ name: 'fake', url: 'http://127.0.0.1:1' }] });
	const { GET } = await import('../../hub/src/routes/api/fleet/+server.js');
	const res = await GET();
	const data = await res.json();
	const fake = data.find(p => p.name === 'fake');
	assert.ok(fake);
	assert.equal(fake.health, null);
	assert.equal(fake.session, null);
});

test('fleet: skips peers with missing name or url', async () => {
	writeConfig({ fleet: [{ name: 'good', url: 'http://1.2.3.4:8080' }, { name: '' }, { url: 'http://bad' }] });
	const { GET } = await import('../../hub/src/routes/api/fleet/+server.js');
	const res = await GET();
	const data = await res.json();
	const names = data.map(p => p.name);
	assert.ok(names.includes('good'));
	assert.ok(!names.includes(''));
});

test('fleet: TLS config uses https scheme for local', async () => {
	writeConfig({ hub: { tls: { cert: '/tmp/cert.pem' } } });
	const { GET } = await import('../../hub/src/routes/api/fleet/+server.js');
	const res = await GET();
	const data = await res.json();
	assert.ok(data[0].url.startsWith('https://'));
});

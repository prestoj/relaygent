/**
 * Tests for /api/vnc — VNC config endpoint.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/vnc-api.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vnc-api-'));
const configDir = path.join(tmpHome, '.relaygent');
fs.mkdirSync(configDir, { recursive: true });

process.env.HOME = tmpHome;

test('returns password and port from config', async () => {
	fs.writeFileSync(path.join(configDir, 'config.json'),
		JSON.stringify({ vnc: { password: 'secret123', port: 5901 } }));
	const mod = await import('../../hub/src/routes/api/vnc/+server.js');
	const res = mod.GET();
	const data = await res.json();
	assert.equal(data.password, 'secret123');
	assert.equal(data.port, 5901);
});

test('returns null password when vnc not in config', async () => {
	fs.writeFileSync(path.join(configDir, 'config.json'),
		JSON.stringify({ agent: { name: 'test' } }));
	// Module is cached, re-read happens inside GET because it reads fs each call
	const mod = await import('../../hub/src/routes/api/vnc/+server.js');
	const res = mod.GET();
	const data = await res.json();
	assert.equal(data.password, null);
	assert.equal(data.port, 5900);
});

test('returns defaults when config file missing', async () => {
	try { fs.unlinkSync(path.join(configDir, 'config.json')); } catch {}
	const mod = await import('../../hub/src/routes/api/vnc/+server.js');
	const res = mod.GET();
	const data = await res.json();
	assert.equal(data.password, null);
	assert.equal(data.port, 5900);
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

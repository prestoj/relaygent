/**
 * Tests for the settings page server loader.
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-settings.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { load } = await import('../../hub/src/routes/settings/+page.server.js');

test('settings load returns system info', async () => {
	const data = await load();
	assert.ok(data.system);
	assert.ok(data.system.hostname);
	assert.ok(data.system.platform);
	assert.ok(data.system.nodeVersion);
	assert.ok(data.system.uptime);
	assert.ok(data.system.cpus > 0);
	assert.ok(data.system.memTotal);
});

test('settings load returns services array', async () => {
	const data = await load();
	assert.ok(Array.isArray(data.services));
	assert.ok(data.services.length > 0);
	const relay = data.services.find(s => s.name === 'Relay');
	assert.ok(relay, 'should include Relay service');
	assert.ok('ok' in relay);
});

test('settings load returns mcpServers array', async () => {
	const data = await load();
	assert.ok(Array.isArray(data.mcpServers));
});

test('settings load returns config object', async () => {
	const data = await load();
	assert.ok(data.config);
	assert.ok('hubPort' in data.config);
	assert.ok('authEnabled' in data.config);
});

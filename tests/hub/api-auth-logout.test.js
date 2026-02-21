/**
 * Tests for POST /api/auth — logout endpoint.
 * Verifies the handler deletes the session cookie and redirects to /login.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-auth-logout.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate HOME so auth.js doesn't touch real config
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-logout-'));
const configDir = path.join(tmpHome, '.relaygent');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), '{}');
process.env.HOME = tmpHome;

const { POST } = await import('../../hub/src/routes/api/auth/+server.js');

test('POST /api/auth deletes session cookie and redirects to /login', async () => {
	const deleted = [];
	const fakeCookies = {
		delete(name, opts) { deleted.push({ name, opts }); }
	};

	try {
		await POST({ cookies: fakeCookies });
		assert.fail('should have thrown a redirect');
	} catch (e) {
		// SvelteKit redirect throws with status and location
		assert.equal(e.status, 302);
		assert.equal(e.location, '/login');
	}

	assert.equal(deleted.length, 1);
	assert.equal(deleted[0].name, 'relaygent_session');
	assert.deepEqual(deleted[0].opts, { path: '/' });
});

test('POST /api/auth always throws (never returns a response)', async () => {
	const fakeCookies = { delete() {} };
	let threw = false;
	try {
		await POST({ cookies: fakeCookies });
	} catch {
		threw = true;
	}
	assert.ok(threw, 'POST should always throw a redirect');
});

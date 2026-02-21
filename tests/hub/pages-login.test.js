/**
 * Tests for the login page server loader and form action.
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-login.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolated HOME for auth config
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'login-page-'));
const configDir = path.join(tmpHome, '.relaygent');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), '{}');
process.env.HOME = tmpHome;

const { load, actions } = await import('../../hub/src/routes/login/+page.server.js');
const { setPasswordInConfig, createSession, COOKIE_NAME } = await import('../../hub/src/lib/auth.js');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function fakeCookies(store = {}) {
	return {
		get(name) { return store[name]; },
		set(name, value, opts) { store[name] = value; },
		delete(name) { delete store[name]; },
	};
}

// --- Load ---

test('load: redirects to / when auth is not enabled', async () => {
	try {
		load({ cookies: fakeCookies() });
		assert.fail('should have thrown redirect');
	} catch (e) {
		assert.equal(e.status, 302);
		assert.equal(e.location, '/');
	}
});

test('load: redirects to / when already authenticated', async () => {
	setPasswordInConfig('testpass');
	const token = createSession();
	try {
		load({ cookies: fakeCookies({ [COOKIE_NAME]: token }) });
		assert.fail('should have thrown redirect');
	} catch (e) {
		assert.equal(e.status, 302);
		assert.equal(e.location, '/');
	}
});

test('load: returns empty object when auth enabled and not logged in', () => {
	// Password was set in previous test
	const result = load({ cookies: fakeCookies() });
	assert.deepEqual(result, {});
});

// --- Actions ---

test('action: returns 401 for wrong password', async () => {
	const form = new FormData();
	form.append('password', 'wrongpassword');
	const result = await actions.default({
		request: new Request('http://localhost/login', { method: 'POST', body: form }),
		cookies: fakeCookies(),
	});
	assert.equal(result.status, 401);
	assert.equal(result.data.incorrect, true);
});

test('action: sets cookie and redirects on correct password', async () => {
	const form = new FormData();
	form.append('password', 'testpass');
	const store = {};
	try {
		await actions.default({
			request: new Request('http://localhost/login', { method: 'POST', body: form }),
			cookies: fakeCookies(store),
		});
		assert.fail('should have thrown redirect');
	} catch (e) {
		assert.equal(e.status, 302);
		assert.equal(e.location, '/');
		assert.ok(store[COOKIE_NAME], 'session cookie should be set');
	}
});

test('action: returns 401 for empty password', async () => {
	const form = new FormData();
	form.append('password', '');
	const result = await actions.default({
		request: new Request('http://localhost/login', { method: 'POST', body: form }),
		cookies: fakeCookies(),
	});
	assert.equal(result.status, 401);
});

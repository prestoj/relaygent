/**
 * Tests for the hub auth gate in hooks.server.js.
 * Focus: a dotted page path (e.g. /kb/foo.md via the [...slug] catch-all) must NOT
 * bypass login for remote clients — the old `!pathname.includes('.')` heuristic let it.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/hooks-auth.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Temp home with auth ENABLED (passwordHash present) + temp data dir for page_hits.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-auth-test-'));
fs.mkdirSync(path.join(tmpHome, '.relaygent'), { recursive: true });
fs.writeFileSync(path.join(tmpHome, '.relaygent', 'config.json'),
	JSON.stringify({ hub: { port: 8080, passwordHash: 'salt:hash' } }));
process.env.HOME = tmpHome;
process.env.RELAYGENT_DATA_DIR = tmpHome;

const { handle } = await import('../../hub/src/hooks.server.js');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

// Build a mock SvelteKit event for a remote (non-localhost) client with no session cookie.
function remoteEvent(pathname) {
	return {
		url: new URL(`https://hub.example${pathname}`),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
	};
}
const resolve = () => 'RESOLVED';

async function statusOf(pathname) {
	try {
		const r = await handle({ event: remoteEvent(pathname), resolve });
		// API paths RETURN a 401 Response; page paths THROW a redirect.
		if (r instanceof Response) return { status: r.status };
		return { resolved: r === 'RESOLVED' };
	} catch (e) {
		return { status: e?.status, location: e?.location };
	}
}

test('remote page route requires auth (302 to /login)', async () => {
	assert.equal((await statusOf('/')).status, 302);
	assert.equal((await statusOf('/settings')).status, 302);
});

test('dotted page path does NOT bypass auth (the fix)', async () => {
	// /kb/foo.md hits the /kb/[...slug] catch-all; must be gated, not served.
	const r = await statusOf('/kb/foo.md');
	assert.equal(r.status, 302, 'dotted slug should redirect to login, not resolve');
});

test('remote API route is gated with 401', async () => {
	const r = await statusOf('/api/secrets');
	assert.equal(r.status, 401);
});

test('real static assets still skip auth', async () => {
	assert.ok((await statusOf('/apple-touch-icon.png')).resolved, 'png asset should pass through');
	assert.ok((await statusOf('/some.css')).resolved, 'css asset should pass through');
});

test('localhost is never gated', async () => {
	const localEvent = {
		url: new URL('https://hub.example/secrets'),
		getClientAddress: () => '127.0.0.1',
		cookies: { get: () => undefined },
	};
	assert.equal(await handle({ event: localEvent, resolve }), 'RESOLVED');
});

/**
 * Integration tests for Chrome DevTools Protocol (cdp.mjs).
 *
 * Requires Chrome running with --remote-debugging-port=9223.
 * Auto-skips all tests when Chrome CDP is not available.
 *
 * Run: node --test tests/computer-use/test_cdp.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

const CDP_PORT = parseInt(process.env.RELAYGENT_CDP_PORT ?? '9223', 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function cdpHttp(path) {
	return new Promise(resolve => {
		const req = http.request(
			{ hostname: 'localhost', port: CDP_PORT, path, timeout: 3000 },
			res => {
				const chunks = [];
				res.on('data', c => chunks.push(c));
				res.on('end', () => {
					try { resolve({ body: JSON.parse(Buffer.concat(chunks)), status: res.statusCode }); }
					catch { resolve({ body: null, status: res.statusCode }); }
				});
			},
		);
		req.on('error', () => resolve(null));
		req.on('timeout', () => { req.destroy(); resolve(null); });
		req.end();
	});
}

function serverAvailable() {
	return cdpHttp('/json/list').then(r => r !== null && Array.isArray(r.body));
}

// Check once at module load (top-level await — requires "type": "module")
const cdpReady = await serverAvailable();
const SKIP = cdpReady ? false : `Chrome CDP not available on port ${CDP_PORT}`;

// ── HTTP API ──────────────────────────────────────────────────────────────────

describe('CDP HTTP API', () => {
	it('cdpHttp returns null for unreachable port', { skip: cdpReady ? 'Chrome is up — test needs no CDP' : false }, async () => {
		// Runs when Chrome is NOT available — verifies the helper handles connection failure cleanly
		const result = await cdpHttp('/json/list');
		assert.equal(result, null);
	});

	it('/json/version returns browser info', { skip: SKIP }, async () => {
		const r = await cdpHttp('/json/version');
		assert.ok(r !== null, 'got response');
		assert.equal(r.status, 200);
		assert.ok(r.body, 'has body');
		assert.ok(typeof r.body.Browser === 'string', 'Browser field is string');
		assert.ok(r.body.Browser.includes('Chrome') || r.body.Browser.includes('Chromium'), 'is Chrome');
	});

	it('/json/list returns array of targets', { skip: SKIP }, async () => {
		const r = await cdpHttp('/json/list');
		assert.ok(r !== null);
		assert.equal(r.status, 200);
		assert.ok(Array.isArray(r.body), 'body is array');
	});

	it('/json/list targets have required fields', { skip: SKIP }, async () => {
		const r = await cdpHttp('/json/list');
		const pages = r.body.filter(t => t.type === 'page');
		assert.ok(pages.length >= 1, 'at least one page target');
		const page = pages[0];
		assert.ok(typeof page.id === 'string', 'id is string');
		assert.ok(typeof page.type === 'string', 'type is string');
		assert.ok(typeof page.url === 'string', 'url is string');
		assert.ok(typeof page.webSocketDebuggerUrl === 'string', 'webSocketDebuggerUrl is string');
		assert.ok(page.webSocketDebuggerUrl.startsWith('ws://'), 'debugger URL is ws://');
	});
});

// ── cdp.mjs module ────────────────────────────────────────────────────────────

let cdpMod;

describe('cdp module', () => {
	before(async () => {
		if (!cdpReady) return;
		cdpMod = await import('../../computer-use/cdp.mjs');
	});

	after(() => {
		if (cdpMod) cdpMod.cdpDisconnect();
	});

	it('cdpAvailable() returns true when Chrome is running', { skip: SKIP }, async () => {
		assert.equal(await cdpMod.cdpAvailable(), true);
	});

	it('getConnection() returns connection with ws property', { skip: SKIP }, async () => {
		const conn = await cdpMod.getConnection();
		assert.ok(conn !== null, 'connection is not null');
		assert.ok(conn.ws, 'has ws property');
	});

	it('cdpEval: evaluates numeric expression', { skip: SKIP }, async () => {
		const result = await cdpMod.cdpEval('1 + 1');
		assert.equal(result, 2);
	});

	it('cdpEval: returns a string', { skip: SKIP }, async () => {
		const result = await cdpMod.cdpEval('"hello"');
		assert.equal(result, 'hello');
	});

	it('cdpEval: returns null for null expression result', { skip: SKIP }, async () => {
		const result = await cdpMod.cdpEval('null');
		assert.equal(result, null);
	});

	it('cdpEval: returns boolean', { skip: SKIP }, async () => {
		assert.equal(await cdpMod.cdpEval('true'), true);
		assert.equal(await cdpMod.cdpEval('false'), false);
	});

	it('cdpEval: handles syntax error without throwing', { skip: SKIP }, async () => {
		// SyntaxError in eval — should return null, not throw
		const result = await cdpMod.cdpEval('{{invalid javascript{{');
		assert.equal(result, null);
	});

	it('cdpEval: document.title returns a string', { skip: SKIP }, async () => {
		const result = await cdpMod.cdpEval('document.title');
		assert.ok(typeof result === 'string', `expected string, got ${typeof result}`);
	});

	it('cdpNavigate: navigates to about:blank and returns true', { skip: SKIP }, async () => {
		const ok = await cdpMod.cdpNavigate('about:blank');
		assert.equal(ok, true);
	});

	it('cdpEval: location.href is about:blank after navigate', { skip: SKIP }, async () => {
		const href = await cdpMod.cdpEval('document.location.href');
		assert.equal(href, 'about:blank');
	});

	it('cdpDisconnect: disconnects without throwing', { skip: SKIP }, () => {
		assert.doesNotThrow(() => cdpMod.cdpDisconnect());
	});

	it('getConnection: reconnects after disconnect', { skip: SKIP }, async () => {
		cdpMod.cdpDisconnect();
		const conn = await cdpMod.getConnection();
		assert.ok(conn !== null, 'reconnected successfully');
		assert.ok(conn.ws, 'has ws after reconnect');
	});

	it('cdpEval: works after reconnect', { skip: SKIP }, async () => {
		const result = await cdpMod.cdpEval('40 + 2');
		assert.equal(result, 42);
	});

	it('cdpConnected: returns true when connected', { skip: SKIP }, async () => {
		await cdpMod.getConnection();
		assert.equal(cdpMod.cdpConnected(), true);
	});

	it('cdpConnected: returns falsy after disconnect', { skip: SKIP }, () => {
		cdpMod.cdpDisconnect();
		assert.ok(!cdpMod.cdpConnected(), 'should be falsy after disconnect');
	});
});

// ── patchChromePrefs ─────────────────────────────────────────────────────────

describe('patchChromePrefs', () => {
	const PREFS_PATH = `${process.env.HOME}/data/chrome-debug-profile/Default/Preferences`;
	const prefsExist = (() => { try { return !!fs.statSync(PREFS_PATH); } catch { return false; } })();
	const PREFS_SKIP = prefsExist ? false : 'Chrome debug profile prefs not found';

	it('does not throw', () => {
		assert.doesNotThrow(() => cdpMod?.patchChromePrefs?.() ?? null);
	});

	it('sets exit_type to Normal', { skip: PREFS_SKIP }, () => {
		cdpMod.patchChromePrefs();
		const prefs = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
		assert.equal(prefs.profile.exit_type, 'Normal');
		assert.equal(prefs.profile.exited_cleanly, true);
	});

	it('blocks permission prompts via default_content_setting_values', { skip: PREFS_SKIP }, () => {
		cdpMod.patchChromePrefs();
		const prefs = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
		const dcsv = prefs.profile.default_content_setting_values;
		assert.ok(dcsv, 'default_content_setting_values exists');
		assert.equal(dcsv.clipboard, 2, 'clipboard blocked');
		assert.equal(dcsv.notifications, 2, 'notifications blocked');
		assert.equal(dcsv.geolocation, 2, 'geolocation blocked');
		assert.equal(dcsv.media_stream_camera, 2, 'camera blocked');
		assert.equal(dcsv.media_stream_mic, 2, 'mic blocked');
	});
});

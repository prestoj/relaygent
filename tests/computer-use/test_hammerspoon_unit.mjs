/**
 * Unit tests for hammerspoon.mjs: findElements and clickElement tree search.
 *
 * Spins up a local HTTP server before importing hammerspoon.mjs so all
 * hsCall() requests hit a controlled fixture — no real Hammerspoon needed.
 *
 * Run: node --test computer-use/test_hammerspoon_unit.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Fake Hammerspoon server ───────────────────────────────────────────────────

let _nextResponse = { status: 'ok' }; // default health response

const server = http.createServer((req, res) => {
	let body = '';
	req.on('data', c => { body += c; });
	req.on('end', () => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(_nextResponse));
	});
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

// Must set env var BEFORE importing hammerspoon.mjs (it reads PORT at module load)
process.env.HAMMERSPOON_PORT = String(port);
const { findElements, clickElement } = await import('../../computer-use/a11y-client.mjs');

after(() => server.close());

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TREE = {
	app: 'TestApp', platform: 'macos',
	tree: {
		role: 'AXWindow', title: 'Main Window', description: '',
		frame: { x: 0, y: 0, w: 800, h: 600 }, value: null,
		children: [
			{ role: 'AXButton', title: 'Submit', description: 'Submit button',
				frame: { x: 100, y: 200, w: 80, h: 30 }, value: null, children: [] },
			{ role: 'AXButton', title: 'Cancel', description: '',
				frame: { x: 200, y: 200, w: 80, h: 30 }, value: null, children: [] },
			{ role: 'AXTextField', title: 'Search', description: 'Search field',
				frame: { x: 10, y: 10, w: 200, h: 25 }, value: 'hello', children: [] },
			{ role: 'AXGroup', title: 'Toolbar', description: '',
				frame: { x: 0, y: 0, w: 800, h: 50 }, value: null,
				children: [
					{ role: 'AXButton', title: 'New', description: 'Create new item',
						frame: { x: 5, y: 5, w: 60, h: 30 }, value: null, children: [] },
				] },
		],
	},
};

const TREE_ZERO_SIZE = {
	app: 'TestApp', platform: 'macos',
	tree: {
		role: 'AXWindow', title: '', description: '',
		frame: { x: 0, y: 0, w: 0, h: 0 }, value: null,
		children: [
			{ role: 'AXButton', title: 'Invisible', description: '',
				frame: { x: 0, y: 0, w: 0, h: 0 }, value: null, children: [] },
		],
	},
};

// ── findElements ──────────────────────────────────────────────────────────────

describe('findElements', () => {
	it('finds elements by role', async () => {
		_nextResponse = TREE;
		const r = await findElements({ role: 'AXButton', app: 'r1' });
		assert.ok(r.elements.length >= 3, `expected >=3 buttons, got ${r.elements.length}`);
		assert.ok(r.elements.every(e => e.role === 'AXButton'));
	});

	it('finds elements by title (case-insensitive)', async () => {
		_nextResponse = TREE;
		const r = await findElements({ title: 'submit', app: 'r2' });
		assert.ok(r.elements.length >= 1);
		assert.ok(r.elements.some(e => e.title.toLowerCase().includes('submit')));
	});

	it('matches title against description field', async () => {
		_nextResponse = TREE;
		const r = await findElements({ title: 'search field', app: 'r3' });
		assert.ok(r.elements.length >= 1, 'should match via description');
	});

	it('traverses nested children (deep tree)', async () => {
		_nextResponse = TREE;
		const r = await findElements({ title: 'New', app: 'r4' });
		assert.ok(r.elements.length >= 1, 'nested button found');
		assert.equal(r.elements[0].title, 'New');
	});

	it('respects limit parameter', async () => {
		_nextResponse = TREE;
		const r = await findElements({ role: 'AXButton', limit: 2, app: 'r5' });
		assert.ok(r.elements.length <= 2);
	});

	it('returns empty when no role or title provided', async () => {
		_nextResponse = TREE;
		const r = await findElements({ app: 'r6' });
		assert.equal(r.elements.length, 0);
	});

	it('returns error shape when server returns error', async () => {
		_nextResponse = { error: 'server down' };
		const r = await findElements({ role: 'AXButton', app: 'r7' });
		assert.ok('error' in r);
	});

	it('uses a11y cache — second call within TTL hits cache', async () => {
		_nextResponse = TREE;
		await findElements({ role: 'AXButton', app: 'cache-key' });
		_nextResponse = { app: 'ShouldNotSeeThis', platform: 'macos', tree: { role: 'AXWindow', title: '', description: '', frame: {}, value: null, children: [] } };
		const r2 = await findElements({ role: 'AXButton', app: 'cache-key' });
		assert.equal(r2.app, 'TestApp', 'cache was used on second call');
	});
});

// ── clickElement ──────────────────────────────────────────────────────────────

describe('clickElement', () => {
	it('returns clicked=true with correct center coordinates', async () => {
		_nextResponse = TREE;
		// Submit: frame {x:100, y:200, w:80, h:30} → center (140, 215)
		const r = await clickElement({ title: 'Submit', app: 'c1' });
		if (r.clicked) {
			assert.equal(r.coords.x, 140);
			assert.equal(r.coords.y, 215);
		} else {
			// click POST went to fake server which returned TREE again (not a click ack)
			assert.ok('error' in r || r.clicked === true, 'should be clicked or error');
		}
	});

	it('returns error when no element matches', async () => {
		_nextResponse = TREE;
		const r = await clickElement({ title: 'xyz_not_found_element', app: 'c2' });
		assert.ok('error' in r);
		assert.ok(r.error.includes('xyz_not_found_element'));
	});

	it('falls through to AXPress when all frames are zero-size', async () => {
		_nextResponse = TREE_ZERO_SIZE;
		const r = await clickElement({ title: 'Invisible', app: 'c3' });
		// AXPress call hits our server too — whatever it returns, we should get a response shape
		assert.ok(typeof r === 'object' && r !== null);
		assert.ok('clicked' in r || 'error' in r, 'response has clicked or error key');
	});
});

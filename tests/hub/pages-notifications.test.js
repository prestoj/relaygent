/**
 * Tests for the notifications page server loader.
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-notifications.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Fake notifications service ────────────────────────────────────────────────
let _handler = (req, res) => {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ entries: [] }));
};

const fakeServer = http.createServer((req, res) => {
	_handler(req, res);
});
await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
const { port } = fakeServer.address();
process.env.RELAYGENT_NOTIFICATIONS_PORT = String(port);

const { load } = await import('../../hub/src/routes/notifications/+page.server.js');

after(() => fakeServer.close());

function makeUrl(params = {}) {
	const u = new URL('http://localhost/notifications');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return u;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('load returns entries from notifications service', async () => {
	const entries = [
		{ id: 1, timestamp: '2026-02-21T10:00:00', type: 'slack', source: 'general', summary: 'New msg' },
		{ id: 2, timestamp: '2026-02-21T09:00:00', type: 'reminder', source: 'reminder', summary: 'Wake up' },
	];
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries }));
	};
	const data = await load({ url: makeUrl() });
	assert.equal(data.entries.length, 2);
	assert.equal(data.entries[0].summary, 'New msg');
	assert.equal(data.page, 1);
	assert.equal(data.limit, 50);
});

test('load defaults to page 1', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries: [] }));
	};
	const data = await load({ url: makeUrl() });
	assert.equal(data.page, 1);
});

test('load parses page param', async () => {
	_handler = (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		assert.equal(url.searchParams.get('offset'), '100'); // page 3 * limit 50 - 50
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries: [] }));
	};
	const data = await load({ url: makeUrl({ page: '3' }) });
	assert.equal(data.page, 3);
});

test('load clamps negative page to 1', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries: [] }));
	};
	const data = await load({ url: makeUrl({ page: '-5' }) });
	assert.equal(data.page, 1);
});

test('load sets hasMore true when entries equal limit', async () => {
	const entries = Array.from({ length: 50 }, (_, i) => ({
		id: i, timestamp: '2026-02-21T10:00:00', type: 'slack', source: 's', summary: `msg ${i}`
	}));
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries }));
	};
	const data = await load({ url: makeUrl() });
	assert.equal(data.hasMore, true);
});

test('load sets hasMore false when entries less than limit', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries: [{ id: 1, type: 'a', source: 'a', summary: 'x' }] }));
	};
	const data = await load({ url: makeUrl() });
	assert.equal(data.hasMore, false);
});

test('load returns error when service unreachable', async () => {
	const origPort = process.env.RELAYGENT_NOTIFICATIONS_PORT;
	process.env.RELAYGENT_NOTIFICATIONS_PORT = '19999';
	const { load: load2 } = await import('../../hub/src/routes/notifications/+page.server.js?v=unreachable');
	const data = await load2({ url: makeUrl() });
	assert.deepEqual(data.entries, []);
	assert.equal(data.hasMore, false);
	assert.ok(data.error);
	process.env.RELAYGENT_NOTIFICATIONS_PORT = origPort;
});

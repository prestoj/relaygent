/**
 * Tests for /api/notifications/history — notification history proxy.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/notifications-history.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Fake notifications service ────────────────────────────────────────────────

let _handler = (req, res) => { res.writeHead(200); res.end(JSON.stringify({ entries: [] })); };

const fakeServer = http.createServer((req, res) => {
	let body = '';
	req.on('data', c => { body += c; });
	req.on('end', () => { req._body = body; _handler(req, res); });
});

await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
const { port } = fakeServer.address();
process.env.RELAYGENT_NOTIFICATIONS_PORT = String(port);

const { GET } = await import('../../hub/src/routes/api/notifications/history/+server.js');

after(() => fakeServer.close());

function makeUrl(params = {}) {
	const u = new URL('http://localhost/api/notifications/history');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GET /api/notifications/history: returns entries from service', async () => {
	const entries = [
		{ id: 1, timestamp: '2026-02-21T10:00:00', type: 'reminder', source: 'reminder', summary: 'Wake up' },
		{ id: 2, timestamp: '2026-02-21T09:00:00', type: 'slack', source: 'general', summary: 'New msg' },
	];
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries, limit: 50, offset: 0 }));
	};
	const res = await GET(makeUrl());
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.entries.length, 2);
	assert.equal(body.entries[0].summary, 'Wake up');
});

test('GET /api/notifications/history: passes limit and offset params', async () => {
	_handler = (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		assert.equal(url.searchParams.get('limit'), '10');
		assert.equal(url.searchParams.get('offset'), '20');
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries: [], limit: 10, offset: 20 }));
	};
	const res = await GET(makeUrl({ limit: '10', offset: '20' }));
	assert.equal(res.status, 200);
});

test('GET /api/notifications/history: clamps limit to 200', async () => {
	_handler = (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		assert.equal(url.searchParams.get('limit'), '200');
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ entries: [] }));
	};
	await GET(makeUrl({ limit: '999' }));
});

test('GET /api/notifications/history: returns empty on service error', async () => {
	// Point to a port nothing listens on
	const origPort = process.env.RELAYGENT_NOTIFICATIONS_PORT;
	process.env.RELAYGENT_NOTIFICATIONS_PORT = '19999';
	const { GET: GET2 } = await import('../../hub/src/routes/api/notifications/history/+server.js?v=2');
	const res = await GET2(makeUrl());
	const body = await res.json();
	assert.deepEqual(body.entries, []);
	assert.ok(body.error);
	process.env.RELAYGENT_NOTIFICATIONS_PORT = origPort;
});

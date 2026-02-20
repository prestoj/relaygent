/**
 * Tests for /api/notifications success paths — GET, POST, DELETE when
 * the notification service IS reachable (fake HTTP server approach).
 *
 * Must set RELAYGENT_NOTIFICATIONS_PORT before importing the route module.
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/notifications-proxy.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Fake notifications service ────────────────────────────────────────────────

let _handler = (req, res) => { res.writeHead(200); res.end(JSON.stringify([])); };

const fakeServer = http.createServer((req, res) => {
	let body = '';
	req.on('data', c => { body += c; });
	req.on('end', () => { req._body = body; _handler(req, res); });
});

await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
const { port } = fakeServer.address();
process.env.RELAYGENT_NOTIFICATIONS_PORT = String(port);

const { GET, POST, DELETE } = await import('../src/routes/api/notifications/+server.js');

after(() => fakeServer.close());

function postReq(body) {
	return { request: new Request('http://localhost/', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body) }) };
}
function urlReq(params = {}) {
	const u = new URL('http://localhost/api/notifications');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

// ── GET: service reachable ────────────────────────────────────────────────────

test('GET /api/notifications: returns reminders from service', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify([{ id: 1, message: 'test', trigger_time: '2026-01-01T00:00:00' }]));
	};
	const res = await GET();
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.reminders));
	assert.equal(body.reminders.length, 1);
	assert.equal(body.reminders[0].id, 1);
});

test('GET /api/notifications: wraps array in reminders key', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify([]));
	};
	const res = await GET();
	const body = await res.json();
	assert.ok('reminders' in body);
	assert.ok(Array.isArray(body.reminders));
});

// ── POST: service reachable ───────────────────────────────────────────────────

test('POST /api/notifications: proxies to service and returns result', async () => {
	_handler = (req, res) => {
		res.writeHead(201, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ id: 42, message: 'wake up', trigger_time: '2026-06-01T09:00:00' }));
	};
	const res = await POST(postReq({ trigger_time: '2026-06-01T09:00:00', message: 'wake up' }));
	assert.equal(res.status, 201);
	const body = await res.json();
	assert.equal(body.id, 42);
});

test('POST /api/notifications: passes status code from service', async () => {
	_handler = (req, res) => {
		res.writeHead(422, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'invalid time' }));
	};
	const res = await POST(postReq({ trigger_time: 'bad', message: 'x' }));
	assert.equal(res.status, 422);
});

// ── DELETE: service reachable ─────────────────────────────────────────────────

test('DELETE /api/notifications: proxies delete to service', async () => {
	_handler = (req, res) => {
		assert.ok(req.url.includes('/reminder/7'));
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true }));
	};
	const res = await DELETE(urlReq({ id: '7' }));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.ok, true);
});

test('DELETE /api/notifications: passes non-200 status from service', async () => {
	_handler = (req, res) => {
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'not found' }));
	};
	const res = await DELETE(urlReq({ id: '99' }));
	assert.equal(res.status, 404);
});

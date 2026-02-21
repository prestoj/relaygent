/**
 * Tests for /api/notifications/pending — proxies notifications service.
 * Uses fake HTTP server pattern (same as notifications-proxy.test.js).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let _handler = (req, res) => { res.writeHead(200); res.end('[]'); };

const fakeServer = http.createServer((req, res) => {
	_handler(req, res);
});

await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
const { port } = fakeServer.address();
process.env.RELAYGENT_NOTIFICATIONS_PORT = String(port);

const { GET } = await import('../../hub/src/routes/api/notifications/pending/+server.js');
after(() => fakeServer.close());

function urlReq(params = {}) {
	const u = new URL('http://localhost/api/notifications/pending');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

test('returns empty array when no notifications', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end('[]');
	};
	const res = await GET(urlReq());
	const body = await res.json();
	assert.deepEqual(body.notifications, []);
});

test('formats reminder notifications', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify([
			{ type: 'reminder', message: 'Check PR', trigger_time: '2026-02-21T10:00:00' }
		]));
	};
	const res = await GET(urlReq());
	const body = await res.json();
	assert.equal(body.notifications.length, 1);
	assert.equal(body.notifications[0].summary, 'Check PR');
	assert.equal(body.notifications[0].source, 'reminder');
	assert.equal(body.notifications[0].time, '2026-02-21T10:00:00');
});

test('formats slack notifications with channel info', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify([
			{ type: 'message', source: 'slack', count: 3,
			  channels: [{ id: 'C1', name: 'general', unread: 3, messages: [] }] }
		]));
	};
	const res = await GET(urlReq());
	const body = await res.json();
	assert.equal(body.notifications.length, 1);
	assert.ok(body.notifications[0].summary.includes('#general'));
});

test('formats github notifications', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify([
			{ type: 'message', source: 'github', count: 1,
			  messages: [{ timestamp: '2026-02-21T10:00:00', content: '[PR] review requested' }] }
		]));
	};
	const res = await GET(urlReq());
	const body = await res.json();
	assert.equal(body.notifications[0].source, 'github');
	assert.ok(body.notifications[0].summary.includes('review'));
});

test('formats task notifications with overdue', async () => {
	_handler = (req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify([
			{ type: 'task', description: 'Daily standup', overdue: '2h overdue' }
		]));
	};
	const res = await GET(urlReq());
	const body = await res.json();
	assert.ok(body.notifications[0].summary.includes('2h overdue'));
});

test('passes fast=1 query parameter to service', async () => {
	let receivedUrl = '';
	_handler = (req, res) => {
		receivedUrl = req.url;
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end('[]');
	};
	await GET(urlReq({ fast: '1' }));
	assert.ok(receivedUrl.includes('fast=1'));
});

test('returns empty with error when service unreachable', async () => {
	fakeServer.close();
	const res = await GET(urlReq());
	const body = await res.json();
	assert.deepEqual(body.notifications, []);
	assert.ok(body.error);
	// Restart for potential other tests
	await new Promise(r => fakeServer.listen(port, '127.0.0.1', r));
});

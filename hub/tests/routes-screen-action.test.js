/**
 * Tests for POST /api/screen/action route handler.
 *
 * Strategy: start a fake computer-use backend on a random port,
 * set HAMMERSPOON_PORT before importing the module, then exercise
 * validation and proxying logic.
 *
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-screen-action.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// --- Fake computer-use backend ---
let handler = (_req, res) => { res.writeHead(200); res.end('{}'); };

const backend = http.createServer((req, res) => {
	let body = '';
	req.on('data', c => body += c);
	req.on('end', () => handler(req, res, body));
});
await new Promise(r => backend.listen(0, '127.0.0.1', r));
const port = backend.address().port;
process.env.HAMMERSPOON_PORT = String(port);

// Import AFTER env is set (BASE is module-level constant)
const { POST } = await import('../src/routes/api/screen/action/+server.js');

function postReq(body) {
	return {
		request: new Request('http://localhost/api/screen/action', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body),
		}),
	};
}

// --- Validation tests ---

test('POST /api/screen/action: invalid JSON returns 400', async () => {
	const res = await POST(postReq('not json'));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Invalid JSON/);
});

test('POST /api/screen/action: missing action returns 400', async () => {
	const res = await POST(postReq({ x: 100, y: 200 }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Invalid action/);
});

test('POST /api/screen/action: unknown action returns 400', async () => {
	const res = await POST(postReq({ action: 'explode' }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Invalid action/);
});

test('POST /api/screen/action: click missing x returns 400', async () => {
	const res = await POST(postReq({ action: 'click', y: 100 }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Missing required field: x/);
});

test('POST /api/screen/action: click missing y returns 400', async () => {
	const res = await POST(postReq({ action: 'click', x: 100 }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Missing required field: y/);
});

test('POST /api/screen/action: type with no text or key returns 400', async () => {
	const res = await POST(postReq({ action: 'type' }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /text or key/);
});

test('POST /api/screen/action: drag missing fields returns 400', async () => {
	const res = await POST(postReq({ action: 'drag', startX: 0 }));
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /Missing required field/);
});

// --- Proxy tests ---

test('POST /api/screen/action: click proxies to /click with params', async () => {
	let captured;
	handler = (req, res, body) => {
		captured = { url: req.url, body: JSON.parse(body) };
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true }));
	};
	const res = await POST(postReq({ action: 'click', x: 500, y: 300 }));
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true });
	assert.equal(captured.url, '/click');
	assert.equal(captured.body.x, 500);
	assert.equal(captured.body.y, 300);
});

test('POST /api/screen/action: type with text proxies to /type', async () => {
	let captured;
	handler = (req, res, body) => {
		captured = { url: req.url, body: JSON.parse(body) };
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true }));
	};
	const res = await POST(postReq({ action: 'type', text: 'hello' }));
	assert.equal(res.status, 200);
	assert.equal(captured.url, '/type');
	assert.equal(captured.body.text, 'hello');
});

test('POST /api/screen/action: type with key proxies to /type', async () => {
	let captured;
	handler = (req, res, body) => {
		captured = { url: req.url, body: JSON.parse(body) };
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true }));
	};
	const res = await POST(postReq({ action: 'type', key: 'Return' }));
	assert.equal(res.status, 200);
	assert.equal(captured.url, '/type');
	assert.equal(captured.body.key, 'Return');
});

test('POST /api/screen/action: scroll proxies to /scroll', async () => {
	let captured;
	handler = (req, res, body) => {
		captured = { url: req.url, body: JSON.parse(body) };
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true }));
	};
	const res = await POST(postReq({ action: 'scroll', x: 100, y: 200, direction: 'down' }));
	assert.equal(res.status, 200);
	assert.equal(captured.url, '/scroll');
	assert.equal(captured.body.direction, 'down');
});

test('POST /api/screen/action: drag proxies to /drag with all coords', async () => {
	let captured;
	handler = (req, res, body) => {
		captured = { url: req.url, body: JSON.parse(body) };
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true }));
	};
	const res = await POST(postReq({ action: 'drag', startX: 10, startY: 20, endX: 300, endY: 400 }));
	assert.equal(res.status, 200);
	assert.equal(captured.url, '/drag');
	assert.deepEqual(captured.body, { startX: 10, startY: 20, endX: 300, endY: 400 });
});

test('POST /api/screen/action: backend error status is forwarded', async () => {
	handler = (_req, res) => {
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'xdotool failed' }));
	};
	const res = await POST(postReq({ action: 'click', x: 1, y: 1 }));
	assert.equal(res.status, 500);
	assert.equal((await res.json()).error, 'xdotool failed');
});

test('POST /api/screen/action: action field not forwarded to backend', async () => {
	let captured;
	handler = (req, res, body) => {
		captured = JSON.parse(body);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end('{}');
	};
	await POST(postReq({ action: 'click', x: 50, y: 60 }));
	assert.equal(captured.action, undefined, 'action should be destructured out');
	assert.equal(captured.x, 50);
	assert.equal(captured.y, 60);
});

// --- Backend unreachable ---
test('POST /api/screen/action: unreachable backend returns 502', async () => {
	await new Promise(r => backend.close(r));
	const res = await POST(postReq({ action: 'click', x: 1, y: 1 }));
	assert.equal(res.status, 502);
	assert.match((await res.json()).error, /unreachable/i);
});

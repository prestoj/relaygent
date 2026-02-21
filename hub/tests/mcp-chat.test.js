/**
 * Tests for hub/mcp-chat.mjs tool handlers.
 * Run: node --test hub/tests/mcp-chat.test.js
 *
 * Tests the tool dispatch logic by extracting and testing the handler
 * functions with a mocked fetch. Does NOT start the MCP stdio transport.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

// Temp dir for notification cache writes
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-test-'));
const NOTIF_CACHE = path.join(TMP, 'cache.json');

// Mock the hub API responses
let fetchMock;
const originalFetch = globalThis.fetch;

function mockFetch(handler) {
	fetchMock = handler;
	globalThis.fetch = async (url, opts) => handler(url, opts);
}

function restoreFetch() {
	globalThis.fetch = originalFetch;
}

// Re-implement the helpers from mcp-chat.mjs for isolated testing
// (importing the module would start the MCP server on stdio)
const HUB_PORT = '18888';
const API = `http://127.0.0.1:${HUB_PORT}/api/chat`;

async function api(p, method = 'GET', body = null) {
	const opts = { method, headers: { 'Content-Type': 'application/json' } };
	if (body) opts.body = JSON.stringify(body);
	const res = await globalThis.fetch(`${API}${p}`, opts);
	if (!res.ok) throw new Error(`Hub API ${method} ${p}: ${res.status} ${res.statusText}`);
	return res.json();
}

function text(msg) {
	return { content: [{ type: 'text', text: typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2) }] };
}

async function handleTool(name, args) {
	try {
		switch (name) {
			case 'read_messages': {
				const mode = args?.mode || 'unread';
				if (mode === 'unread') {
					const data = await api('?mode=unread');
					if (!data.count) return text('No unread messages.');
					const lines = data.messages.map(m => m.content);
					await api('', 'PATCH', { ids: data.messages.map(m => m.id) });
					try { fs.writeFileSync(NOTIF_CACHE, '[]'); } catch {}
					return text(`${data.count} unread message(s):\n${lines.join('\n')}`);
				}
				const limit = args?.limit || 20;
				const data = await api(`?limit=${limit}`);
				const msgs = (data.messages || []).reverse();
				if (!msgs.length) return text('No messages yet.');
				const lines = msgs.map(m => `[${m.id}] ${m.role}: ${m.content}`);
				return text(lines.join('\n'));
			}
			case 'send_message': {
				const msg = await api('', 'POST', { content: args.content, role: 'assistant' });
				return text(`Sent (id: ${msg.id}): ${msg.content}`);
			}
			case 'mark_read': {
				await api('', 'PATCH', { ids: args.ids });
				try { fs.writeFileSync(NOTIF_CACHE, '[]'); } catch {}
				return text(`Marked ${args.ids.length} message(s) as read.`);
			}
			default:
				return text(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
	}
}

describe('text helper', () => {
	it('wraps string in MCP content format', () => {
		const result = text('hello');
		assert.deepEqual(result, { content: [{ type: 'text', text: 'hello' }] });
	});

	it('JSON-stringifies objects', () => {
		const result = text({ key: 'val' });
		assert.equal(result.content[0].text, '{\n  "key": "val"\n}');
	});
});

describe('read_messages (unread mode)', () => {
	it('returns no-unread message when count is 0', async () => {
		mockFetch(async () => new Response(JSON.stringify({ count: 0, messages: [] })));
		const result = await handleTool('read_messages', { mode: 'unread' });
		assert.ok(result.content[0].text.includes('No unread'));
		restoreFetch();
	});

	it('returns messages and auto-marks as read', async () => {
		let patchCalled = false;
		mockFetch(async (url, opts) => {
			if (opts?.method === 'PATCH') {
				patchCalled = true;
				return new Response(JSON.stringify({ ok: true }));
			}
			return new Response(JSON.stringify({
				count: 2,
				messages: [
					{ id: 1, content: 'hello', role: 'human' },
					{ id: 2, content: 'world', role: 'human' },
				],
			}));
		});
		const result = await handleTool('read_messages', { mode: 'unread' });
		assert.ok(result.content[0].text.includes('2 unread'));
		assert.ok(result.content[0].text.includes('hello'));
		assert.ok(result.content[0].text.includes('world'));
		assert.ok(patchCalled, 'should auto-mark as read');
		restoreFetch();
	});

	it('clears notification cache after reading unread', async () => {
		// Seed a non-empty cache
		fs.writeFileSync(NOTIF_CACHE, '[{"type":"message"}]');
		mockFetch(async (url, opts) => {
			if (opts?.method === 'PATCH') return new Response('{"ok":true}');
			return new Response(JSON.stringify({
				count: 1, messages: [{ id: 5, content: 'hi' }],
			}));
		});
		await handleTool('read_messages', { mode: 'unread' });
		assert.equal(fs.readFileSync(NOTIF_CACHE, 'utf-8'), '[]');
		restoreFetch();
	});
});

describe('read_messages (history mode)', () => {
	it('returns formatted history', async () => {
		mockFetch(async () => new Response(JSON.stringify({
			messages: [
				{ id: 3, role: 'assistant', content: 'newer' },
				{ id: 2, role: 'human', content: 'older' },
			],
		})));
		const result = await handleTool('read_messages', { mode: 'history' });
		const t = result.content[0].text;
		assert.ok(t.includes('[2] human: older'));
		assert.ok(t.includes('[3] assistant: newer'));
		restoreFetch();
	});

	it('returns no-messages when empty', async () => {
		mockFetch(async () => new Response(JSON.stringify({ messages: [] })));
		const result = await handleTool('read_messages', { mode: 'history' });
		assert.ok(result.content[0].text.includes('No messages'));
		restoreFetch();
	});

	it('defaults to unread mode when no mode specified', async () => {
		mockFetch(async (url) => {
			assert.ok(url.includes('unread'), 'should default to unread');
			return new Response(JSON.stringify({ count: 0, messages: [] }));
		});
		await handleTool('read_messages', {});
		restoreFetch();
	});
});

describe('send_message', () => {
	it('sends message and returns confirmation', async () => {
		mockFetch(async (url, opts) => {
			const body = JSON.parse(opts.body);
			assert.equal(body.content, 'test message');
			assert.equal(body.role, 'assistant');
			return new Response(JSON.stringify({ id: 42, content: 'test message' }));
		});
		const result = await handleTool('send_message', { content: 'test message' });
		assert.ok(result.content[0].text.includes('Sent (id: 42)'));
		assert.ok(result.content[0].text.includes('test message'));
		restoreFetch();
	});
});

describe('mark_read', () => {
	it('marks messages as read', async () => {
		let patchedIds;
		mockFetch(async (url, opts) => {
			patchedIds = JSON.parse(opts.body).ids;
			return new Response(JSON.stringify({ ok: true }));
		});
		const result = await handleTool('mark_read', { ids: [1, 2, 3] });
		assert.deepEqual(patchedIds, [1, 2, 3]);
		assert.ok(result.content[0].text.includes('3 message(s)'));
		restoreFetch();
	});

	it('clears notification cache', async () => {
		fs.writeFileSync(NOTIF_CACHE, '[{"old":true}]');
		mockFetch(async () => new Response('{"ok":true}'));
		await handleTool('mark_read', { ids: [1] });
		assert.equal(fs.readFileSync(NOTIF_CACHE, 'utf-8'), '[]');
		restoreFetch();
	});
});

describe('error handling', () => {
	it('returns isError on API failure', async () => {
		mockFetch(async () => new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }));
		const result = await handleTool('read_messages', { mode: 'unread' });
		assert.ok(result.isError);
		assert.ok(result.content[0].text.includes('Error'));
		restoreFetch();
	});

	it('unknown tool returns message', async () => {
		const result = await handleTool('nonexistent', {});
		assert.ok(result.content[0].text.includes('Unknown tool'));
		restoreFetch();
	});
});

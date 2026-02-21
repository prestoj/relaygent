/**
 * Tests for notifications/slack-socket-listener.mjs cache and filtering logic.
 * Run: node --test tests/notifications/test_socket_listener.mjs
 *
 * The listener auto-starts on import, so we re-implement the pure functions
 * here and test them in isolation (same pattern as mcp-chat.test.js).
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'socket-listener-test-'));
const CACHE_FILE = path.join(tmpDir, 'socket-cache.json');
const LAST_ACK_FILE = path.join(tmpDir, 'last-ack');
const MAX_MESSAGES = 50;

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// --- Re-implement pure functions from slack-socket-listener.mjs ---

function readCache() {
	try {
		const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
		if (!Array.isArray(data.messages)) data.messages = [];
		return data;
	} catch {
		return { messages: [], updated: 0 };
	}
}

function writeCache(data) {
	data.updated = Date.now();
	const tmp = CACHE_FILE + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
	fs.renameSync(tmp, CACHE_FILE);
}

function getLastAckTs() {
	try {
		return parseFloat(fs.readFileSync(LAST_ACK_FILE, 'utf-8').trim()) || 0;
	} catch {
		return 0;
	}
}

// Message filtering logic extracted from the "message" handler
const skipSubtypes = new Set([
	'channel_join', 'joiner_notification_for_inviter',
	'bot_message', 'message_changed', 'message_deleted',
]);

function shouldSkipMessage(event, selfUid) {
	if (!event) return true;
	if (event.user === selfUid) return true;
	if (event.subtype && skipSubtypes.has(event.subtype)) return true;
	const lastAck = getLastAckTs();
	if (parseFloat(event.ts || '0') <= lastAck) return true;
	if (!event.channel) return true;
	return false;
}

// --- Tests ---

describe('readCache', () => {
	it('returns empty cache when file missing', () => {
		const c = readCache();
		assert.deepEqual(c.messages, []);
		assert.equal(c.updated, 0);
	});

	it('reads valid cache file', () => {
		writeCache({ messages: [{ ts: '1.0', text: 'hi' }] });
		const c = readCache();
		assert.equal(c.messages.length, 1);
		assert.equal(c.messages[0].text, 'hi');
		assert.ok(c.updated > 0);
	});

	it('repairs cache with missing messages array', () => {
		fs.writeFileSync(CACHE_FILE, JSON.stringify({ updated: 1 }));
		const c = readCache();
		assert.deepEqual(c.messages, []);
	});

	it('handles corrupt JSON gracefully', () => {
		fs.writeFileSync(CACHE_FILE, '{broken json');
		const c = readCache();
		assert.deepEqual(c.messages, []);
	});
});

describe('writeCache', () => {
	it('writes cache atomically with tmp file', () => {
		writeCache({ messages: [{ ts: '2.0', text: 'hello' }] });
		assert.ok(fs.existsSync(CACHE_FILE));
		assert.ok(!fs.existsSync(CACHE_FILE + '.tmp'), 'tmp file should be renamed away');
		const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
		assert.equal(c.messages[0].text, 'hello');
	});

	it('sets updated timestamp', () => {
		const before = Date.now();
		writeCache({ messages: [] });
		const c = readCache();
		assert.ok(c.updated >= before);
	});

	it('preserves knownChannels', () => {
		writeCache({ messages: [], knownChannels: ['C1', 'D2'] });
		const c = readCache();
		assert.deepEqual(c.knownChannels, ['C1', 'D2']);
	});
});

describe('getLastAckTs', () => {
	it('returns 0 when file missing', () => {
		assert.equal(getLastAckTs(), 0);
	});

	it('reads timestamp from file', () => {
		fs.writeFileSync(LAST_ACK_FILE, '1700000000.123');
		assert.equal(getLastAckTs(), 1700000000.123);
	});

	it('returns 0 for invalid content', () => {
		fs.writeFileSync(LAST_ACK_FILE, 'not-a-number');
		assert.equal(getLastAckTs(), 0);
	});
});

describe('message filtering', () => {
	it('skips null events', () => {
		assert.ok(shouldSkipMessage(null, 'U1'));
	});

	it('skips own messages', () => {
		assert.ok(shouldSkipMessage({ user: 'U1', ts: '9999.0', channel: 'C1' }, 'U1'));
	});

	it('skips bot messages', () => {
		assert.ok(shouldSkipMessage({ user: 'U2', subtype: 'bot_message', ts: '9999.0', channel: 'C1' }, 'U1'));
	});

	it('skips channel_join', () => {
		assert.ok(shouldSkipMessage({ user: 'U2', subtype: 'channel_join', ts: '9999.0', channel: 'C1' }, 'U1'));
	});

	it('skips message_changed', () => {
		assert.ok(shouldSkipMessage({ user: 'U2', subtype: 'message_changed', ts: '9999.0', channel: 'C1' }, 'U1'));
	});

	it('skips message_deleted', () => {
		assert.ok(shouldSkipMessage({ user: 'U2', subtype: 'message_deleted', ts: '9999.0', channel: 'C1' }, 'U1'));
	});

	it('skips messages older than last ack', () => {
		fs.writeFileSync(LAST_ACK_FILE, '1000.0');
		assert.ok(shouldSkipMessage({ user: 'U2', ts: '999.0', channel: 'C1' }, 'U1'));
	});

	it('skips messages without channel', () => {
		assert.ok(shouldSkipMessage({ user: 'U2', ts: '9999.0' }, 'U1'));
	});

	it('accepts valid new messages', () => {
		fs.writeFileSync(LAST_ACK_FILE, '1000.0');
		assert.ok(!shouldSkipMessage({ user: 'U2', ts: '2000.0', channel: 'C1' }, 'U1'));
	});

	it('accepts messages with no subtype', () => {
		fs.writeFileSync(LAST_ACK_FILE, '0');
		assert.ok(!shouldSkipMessage({ user: 'U2', ts: '5.0', channel: 'C1' }, 'U1'));
	});
});

describe('cache message trimming', () => {
	it('trims messages to MAX_MESSAGES', () => {
		const msgs = Array.from({ length: 60 }, (_, i) => ({ ts: `${i}.0`, text: `msg${i}` }));
		const cache = { messages: msgs };
		if (cache.messages.length > MAX_MESSAGES) {
			cache.messages = cache.messages.slice(-MAX_MESSAGES);
		}
		writeCache(cache);
		const c = readCache();
		assert.equal(c.messages.length, MAX_MESSAGES);
		assert.equal(c.messages[0].text, 'msg10'); // first 10 trimmed
		assert.equal(c.messages[49].text, 'msg59');
	});
});

describe('knownChannels tracking', () => {
	it('adds new channel to knownChannels', () => {
		const cache = readCache();
		if (!cache.knownChannels) cache.knownChannels = [];
		const channelId = 'C_NEW_123';
		if (!cache.knownChannels.includes(channelId)) {
			cache.knownChannels.push(channelId);
		}
		writeCache(cache);
		const c = readCache();
		assert.ok(c.knownChannels.includes('C_NEW_123'));
	});

	it('does not duplicate existing channels', () => {
		writeCache({ messages: [], knownChannels: ['C1'] });
		const cache = readCache();
		if (!cache.knownChannels.includes('C1')) cache.knownChannels.push('C1');
		writeCache(cache);
		const c = readCache();
		assert.equal(c.knownChannels.filter(x => x === 'C1').length, 1);
	});
});

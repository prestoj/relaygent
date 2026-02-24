import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortName, cat, relTime, itemKey } from '../../hub/src/lib/activityUtils.js';

describe('activityUtils', () => {
	describe('shortName', () => {
		it('returns ? for null/undefined', () => {
			assert.equal(shortName(null), '?');
			assert.equal(shortName(undefined), '?');
		});
		it('returns name as-is for non-mcp tools', () => {
			assert.equal(shortName('Read'), 'Read');
			assert.equal(shortName('Bash'), 'Bash');
		});
		it('formats mcp tool names', () => {
			assert.equal(shortName('mcp__computer-use__screenshot'), 'computer-use.screenshot');
			assert.equal(shortName('mcp__slack__send_message'), 'slack.send_message');
		});
		it('strips provider prefix from action', () => {
			assert.equal(shortName('mcp__hub-chat__hub-chat_read'), 'hub-chat.read');
		});
	});

	describe('cat', () => {
		it('categorizes file tools', () => {
			for (const name of ['Read', 'Edit', 'Write', 'Glob', 'Grep']) {
				assert.equal(cat(name), 'file');
			}
		});
		it('categorizes bash', () => assert.equal(cat('Bash'), 'bash'));
		it('categorizes mcp tools', () => assert.equal(cat('mcp__slack__send'), 'mcp'));
		it('returns other for unknown', () => assert.equal(cat('TodoWrite'), 'other'));
		it('returns other for null', () => assert.equal(cat(null), 'other'));
	});

	describe('relTime', () => {
		const now = Date.now();
		it('returns "now" for <5s', () => assert.equal(relTime(now, new Date(now - 2000).toISOString()), 'now'));
		it('returns seconds for <60s', () => assert.equal(relTime(now, new Date(now - 30000).toISOString()), '30s'));
		it('returns minutes for <1h', () => assert.equal(relTime(now, new Date(now - 300000).toISOString()), '5m'));
		it('returns hours for >=1h', () => assert.equal(relTime(now, new Date(now - 7200000).toISOString()), '2h'));
	});

	describe('itemKey', () => {
		it('uses toolUseId if present', () => {
			assert.equal(itemKey({ toolUseId: 'abc-123', time: 't', name: 'Read' }), 'abc-123');
		});
		it('falls back to time-name', () => {
			assert.equal(itemKey({ time: '2026-01-01', name: 'Read' }), '2026-01-01-Read');
		});
		it('uses type if no name', () => {
			assert.equal(itemKey({ time: '2026-01-01', type: 'text' }), '2026-01-01-text');
		});
	});
});

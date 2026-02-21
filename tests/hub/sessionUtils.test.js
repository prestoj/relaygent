/**
 * Tests for hub/src/lib/sessionUtils.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemKey, fmtTime, fmtTokens, toolCategory, shortName, fmtParams } from '../../hub/src/lib/sessionUtils.js';

test('itemKey: uses toolUseId when present', () => {
	assert.equal(itemKey({ toolUseId: 'abc', time: '2026-01-01' }, 0), 'abc');
});

test('itemKey: falls back to time-index', () => {
	assert.equal(itemKey({ time: '2026-01-01' }, 3), '2026-01-01-3');
});

test('fmtTime: returns empty for falsy', () => {
	assert.equal(fmtTime(''), '');
	assert.equal(fmtTime(null), '');
	assert.equal(fmtTime(undefined), '');
});

test('fmtTime: formats ISO timestamp', () => {
	const result = fmtTime('2026-02-21T12:30:45Z');
	assert.match(result, /\d{2}:\d{2}:\d{2}/);
});

test('fmtTokens: handles zero and falsy', () => {
	assert.equal(fmtTokens(0), '0');
	assert.equal(fmtTokens(null), '0');
	assert.equal(fmtTokens(undefined), '0');
});

test('fmtTokens: formats thousands', () => {
	assert.equal(fmtTokens(1500), '2K');
	assert.equal(fmtTokens(50000), '50K');
});

test('fmtTokens: formats millions', () => {
	assert.equal(fmtTokens(1_200_000), '1.2M');
	assert.equal(fmtTokens(3_500_000), '3.5M');
});

test('fmtTokens: small numbers as-is', () => {
	assert.equal(fmtTokens(42), '42');
	assert.equal(fmtTokens(999), '999');
});

test('toolCategory: file tools', () => {
	for (const t of ['Read', 'Edit', 'Write', 'Glob', 'Grep']) {
		assert.equal(toolCategory(t), 'file');
	}
});

test('toolCategory: bash', () => {
	assert.equal(toolCategory('Bash'), 'bash');
});

test('toolCategory: mcp tools', () => {
	assert.equal(toolCategory('mcp__slack__send_message'), 'mcp');
	assert.equal(toolCategory('mcp__hub-chat__read_messages'), 'mcp');
});

test('toolCategory: other and falsy', () => {
	assert.equal(toolCategory('Task'), 'other');
	assert.equal(toolCategory('TodoWrite'), 'other');
	assert.equal(toolCategory(null), 'other');
	assert.equal(toolCategory(''), 'other');
});

test('shortName: non-mcp passthrough', () => {
	assert.equal(shortName('Read'), 'Read');
	assert.equal(shortName('Bash'), 'Bash');
});

test('shortName: mcp name shortening', () => {
	assert.equal(shortName('mcp__slack__send_message'), 'slack.send_message');
	assert.equal(shortName('mcp__hub-chat__read_messages'), 'hub-chat.read_messages');
});

test('fmtParams: empty cases', () => {
	assert.equal(fmtParams(null), '');
	assert.equal(fmtParams({}), '');
	assert.equal(fmtParams(undefined), '');
});

test('fmtParams: formats string values', () => {
	const result = fmtParams({ file: '/tmp/test.js', mode: 'read' });
	assert.equal(result, 'file: /tmp/test.js\nmode: read');
});

test('fmtParams: formats array values as JSON', () => {
	const result = fmtParams({ items: [1, 2] });
	assert.ok(result.includes('items:'));
	assert.ok(result.includes('['));
});

test('fmtParams: skips null/undefined values', () => {
	const result = fmtParams({ a: 'yes', b: null, c: undefined, d: 'ok' });
	assert.equal(result, 'a: yes\nd: ok');
});

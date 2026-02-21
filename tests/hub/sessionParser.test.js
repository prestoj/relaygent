/**
 * Tests for hub/src/lib/sessionParser.js
 * Run: node --test tests/hub/sessionParser.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionParser } from '../../hub/src/lib/sessionParser.js';

function makeParser(onResult = () => {}) {
	return createSessionParser({
		onResult,
		summarizeInput: (name, input) => `${name}(${JSON.stringify(input)})`,
		summarizeResult: (content) => typeof content === 'string' ? content : JSON.stringify(content),
		extractResultText: (content) => typeof content === 'string' ? content : JSON.stringify(content),
	});
}

function toolUseLine(id, name, input = {}, ts = '2026-01-01T00:00:00Z') {
	return JSON.stringify({
		type: 'assistant', timestamp: ts,
		message: { content: [{ type: 'tool_use', id, name, input }] },
	});
}

function textLine(text, ts = '2026-01-01T00:00:00Z') {
	return JSON.stringify({
		type: 'assistant', timestamp: ts,
		message: { content: [{ type: 'text', text }] },
	});
}

function resultLine(toolUseId, content = 'ok') {
	return JSON.stringify({
		type: 'user',
		message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
	});
}

describe('parseLine: assistant tool_use', () => {
	test('returns tool activity', () => {
		const p = makeParser();
		const acts = p.parseLine(toolUseLine('t1', 'Read', { file: '/a.txt' }));
		assert.equal(acts.length, 1);
		assert.equal(acts[0].type, 'tool');
		assert.equal(acts[0].name, 'Read');
		assert.equal(acts[0].toolUseId, 't1');
		assert.equal(acts[0].time, '2026-01-01T00:00:00Z');
		assert.equal(acts[0].result, '');
	});

	test('tracks tool in pendingTools', () => {
		const p = makeParser();
		p.parseLine(toolUseLine('t1', 'Read'));
		assert.ok(p.pendingTools.has('t1'));
	});

	test('multiple tool_use items in one message', () => {
		const p = makeParser();
		const line = JSON.stringify({
			type: 'assistant', timestamp: 'ts',
			message: { content: [
				{ type: 'tool_use', id: 'a', name: 'Read', input: {} },
				{ type: 'tool_use', id: 'b', name: 'Write', input: {} },
			] },
		});
		const acts = p.parseLine(line);
		assert.equal(acts.length, 2);
		assert.equal(acts[0].name, 'Read');
		assert.equal(acts[1].name, 'Write');
	});
});

describe('parseLine: assistant text', () => {
	test('returns text activity for text > 10 chars', () => {
		const p = makeParser();
		const acts = p.parseLine(textLine('Hello, this is a long message'));
		assert.equal(acts.length, 1);
		assert.equal(acts[0].type, 'text');
		assert.equal(acts[0].text, 'Hello, this is a long message');
	});

	test('ignores short text (<=10 chars)', () => {
		const p = makeParser();
		const acts = p.parseLine(textLine('short'));
		assert.equal(acts.length, 0);
	});

	test('ignores exactly 10 char text', () => {
		const p = makeParser();
		const acts = p.parseLine(textLine('1234567890'));
		assert.equal(acts.length, 0);
	});
});

describe('parseLine: user tool_result', () => {
	test('calls onResult for matching pending tool', () => {
		const results = [];
		const p = makeParser((r) => results.push(r));
		p.parseLine(toolUseLine('t1', 'Read'));
		p.parseLine(resultLine('t1', 'file contents'));
		assert.equal(results.length, 1);
		assert.equal(results[0].toolUseId, 't1');
		assert.equal(results[0].result, 'file contents');
	});

	test('removes tool from pendingTools after result', () => {
		const p = makeParser();
		p.parseLine(toolUseLine('t1', 'Read'));
		assert.ok(p.pendingTools.has('t1'));
		p.parseLine(resultLine('t1', 'done'));
		assert.ok(!p.pendingTools.has('t1'));
	});

	test('ignores result for unknown tool', () => {
		const results = [];
		const p = makeParser((r) => results.push(r));
		p.parseLine(resultLine('unknown', 'data'));
		assert.equal(results.length, 0);
	});
});

describe('parseLine: edge cases', () => {
	test('invalid JSON returns empty array', () => {
		const p = makeParser();
		const acts = p.parseLine('not json {{{');
		assert.deepEqual(acts, []);
	});

	test('empty line returns empty array', () => {
		const p = makeParser();
		assert.deepEqual(p.parseLine(''), []);
	});

	test('content as string (not array) is handled', () => {
		const p = makeParser();
		const line = JSON.stringify({
			type: 'assistant', timestamp: 'ts',
			message: { content: 'This is a plain string message longer than ten' },
		});
		const acts = p.parseLine(line);
		assert.equal(acts.length, 0); // string content items have no .type
	});

	test('null content items are skipped', () => {
		const p = makeParser();
		const line = JSON.stringify({
			type: 'assistant', timestamp: 'ts',
			message: { content: [null, undefined, { type: 'tool_use', id: 'x', name: 'Bash', input: {} }] },
		});
		const acts = p.parseLine(line);
		assert.equal(acts.length, 1);
		assert.equal(acts[0].name, 'Bash');
	});

	test('missing message field returns empty', () => {
		const p = makeParser();
		assert.deepEqual(p.parseLine(JSON.stringify({ type: 'assistant' })), []);
	});
});

describe('pendingTools eviction', () => {
	test('evicts oldest when exceeding MAX_PENDING (200)', () => {
		const p = makeParser();
		for (let i = 0; i < 201; i++) {
			p.parseLine(toolUseLine(`t${i}`, 'Read'));
		}
		assert.equal(p.pendingTools.size, 200);
		assert.ok(!p.pendingTools.has('t0'), 'oldest tool evicted');
		assert.ok(p.pendingTools.has('t1'), 'second tool kept');
		assert.ok(p.pendingTools.has('t200'), 'newest tool kept');
	});
});

describe('clear', () => {
	test('clears all pending tools', () => {
		const p = makeParser();
		p.parseLine(toolUseLine('t1', 'Read'));
		p.parseLine(toolUseLine('t2', 'Write'));
		assert.equal(p.pendingTools.size, 2);
		p.clear();
		assert.equal(p.pendingTools.size, 0);
	});
});

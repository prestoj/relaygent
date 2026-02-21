/**
 * Tests for sessionStats.js — parseSessionStats extracted from relayStats.js.
 * Tests direct import, caching, edge cases, and token/tool counting.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let parseSessionStats;
let tmpDir;

function makeEntry(type, content, timestamp, usage) {
	return JSON.stringify({
		type, timestamp,
		message: { usage, content },
	});
}

const TS1 = '2026-01-01T10:00:00.000Z';
const TS2 = '2026-01-01T10:30:00.000Z';
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };

function writeFixture(name, lines) {
	const p = path.join(tmpDir, name);
	fs.writeFileSync(p, lines.join('\n') + '\n');
	return p;
}

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-stats-test-'));
	process.env.HOME = tmpDir;
	({ parseSessionStats } = await import('../../hub/src/lib/sessionStats.js'));
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// ── Direct import ──────────────────────────────────────────────────────────

test('parseSessionStats: importable directly from sessionStats.js', () => {
	assert.equal(typeof parseSessionStats, 'function');
});

// ── Basic parsing ──────────────────────────────────────────────────────────

test('parseSessionStats: returns correct shape for valid JSONL', () => {
	const lines = [
		makeEntry('assistant', [{ type: 'text', text: 'Hello world, starting session.' }], TS1, USAGE),
		makeEntry('assistant', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }], TS2, USAGE),
	];
	const p = writeFixture('basic.jsonl', lines);
	const s = parseSessionStats(p);
	assert.ok(s);
	assert.equal(s.start, TS1);
	assert.equal(s.durationMin, 30);
	assert.equal(s.turns, 2);
	assert.equal(s.toolCalls, 1);
	assert.equal(s.textBlocks, 1);
	assert.equal(s.totalTokens, 3000); // (1000+500)*2
	assert.equal(s.outputTokens, 400); // 200*2
	assert.deepEqual(s.tools, { Read: 1 });
	assert.ok(s.firstText.startsWith('Hello world'));
});

// ── Token counting ─────────────────────────────────────────────────────────

test('parseSessionStats: counts cache_creation_input_tokens', () => {
	const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 300 };
	const lines = [
		makeEntry('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x'.repeat(200) } }], TS1, usage),
		makeEntry('assistant', [{ type: 'text', text: 'More text content here.' }], TS2, usage),
	];
	const p = writeFixture('cache-create.jsonl', lines);
	const s = parseSessionStats(p);
	assert.equal(s.totalTokens, 800); // (100+300)*2
});

// ── Tool counting ──────────────────────────────────────────────────────────

test('parseSessionStats: counts multiple tool types', () => {
	const lines = [
		makeEntry('assistant', [
			{ type: 'tool_use', id: 't1', name: 'Read', input: {} },
			{ type: 'tool_use', id: 't2', name: 'Write', input: {} },
			{ type: 'tool_use', id: 't3', name: 'Read', input: {} },
		], TS1, USAGE),
		makeEntry('assistant', [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'x'.repeat(100) } }], TS2, USAGE),
	];
	const p = writeFixture('multi-tool.jsonl', lines);
	const s = parseSessionStats(p);
	assert.equal(s.toolCalls, 4);
	assert.deepEqual(s.tools, { Read: 2, Write: 1, Bash: 1 });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test('parseSessionStats: returns null for nonexistent file', () => {
	assert.equal(parseSessionStats('/nonexistent/file.jsonl'), null);
});

test('parseSessionStats: returns null for file under 500 bytes', () => {
	const p = path.join(tmpDir, 'tiny.jsonl');
	fs.writeFileSync(p, '{"type":"assistant"}\n');
	assert.equal(parseSessionStats(p), null);
});

test('parseSessionStats: returns null for single-line file', () => {
	const p = writeFixture('single.jsonl', [
		makeEntry('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x'.repeat(400) } }], TS1, USAGE),
	]);
	assert.equal(parseSessionStats(p), null);
});

test('parseSessionStats: skips malformed JSON lines gracefully', () => {
	const lines = [
		makeEntry('assistant', [{ type: 'text', text: 'Starting work on the task.' }], TS1, USAGE),
		'NOT VALID JSON {{{',
		makeEntry('assistant', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x'.repeat(100) } }], TS2, USAGE),
	];
	const p = writeFixture('malformed.jsonl', lines);
	const s = parseSessionStats(p);
	assert.ok(s);
	assert.equal(s.turns, 2);
});

// ── Caching ────────────────────────────────────────────────────────────────

test('parseSessionStats: returns cached result on second call', () => {
	const lines = [
		makeEntry('assistant', [{ type: 'text', text: 'Cached test session content.' }], TS1, USAGE),
		makeEntry('assistant', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x'.repeat(100) } }], TS2, USAGE),
	];
	const p = writeFixture('cached.jsonl', lines);
	const s1 = parseSessionStats(p);
	const s2 = parseSessionStats(p);
	assert.deepEqual(s1, s2);
});

// ── contextPct ─────────────────────────────────────────────────────────────

test('parseSessionStats: contextPct is totalTokens / 2000 rounded', () => {
	const lines = [
		makeEntry('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x'.repeat(200) } }], TS1, USAGE),
		makeEntry('assistant', [{ type: 'text', text: 'More context pct content here.' }], TS2, USAGE),
	];
	const p = writeFixture('ctx-pct.jsonl', lines);
	const s = parseSessionStats(p);
	assert.equal(s.contextPct, Math.round(s.totalTokens / 2000));
});

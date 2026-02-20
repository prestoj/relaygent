/**
 * Tests for hub/src/lib/relayStats.js
 * Uses Node.js built-in test runner.
 *
 * Strategy: set HOME to a tmpDir BEFORE import so CLAUDE_PROJECTS points
 * to our controlled directory. Each test that needs fresh data must work
 * around the 5-min module-level cache — we write all fixture data BEFORE
 * the first call and rely on structure/type assertions for cached calls.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let projectsDir;
let getRelayStats;

function makeEntry(type, opts = {}) {
	const base = { type, timestamp: opts.timestamp || new Date().toISOString() };
	if (type === 'assistant') {
		return {
			...base,
			message: {
				usage: opts.usage || {
					input_tokens: 100, output_tokens: 50,
					cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
				},
				content: opts.content || [],
			},
		};
	}
	return { ...base, message: { content: opts.content || [] } };
}

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-stats-test-'));
	projectsDir = path.join(tmpDir, '.claude', 'projects');
	fs.mkdirSync(projectsDir, { recursive: true });

	// Write all fixture data BEFORE importing, so the first call picks it up
	// (the module caches results for 5 minutes — we can't clear the cache)
	const start = '2026-02-19T10:00:00.000Z';
	const end   = '2026-02-19T10:30:00.000Z';
	const wsDir = path.join(projectsDir, 'test-workspace');
	fs.mkdirSync(wsDir, { recursive: true });

	// A real-looking session with 3 tool calls (2 Bash, 1 Read) across 2 turns
	const entries = [
		makeEntry('assistant', {
			timestamp: start,
			usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
			content: [
				{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
				{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/foo' } },
				{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'pwd' } },
				{ type: 'text', text: 'Some assistant text output.' },
			],
		}),
		makeEntry('assistant', {
			timestamp: end,
			usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			content: [],
		}),
	];
	// Make content long enough to pass the 500-byte size check
	const jsonl = entries.map(e => JSON.stringify(e)).join('\n') + '\n'.repeat(20);
	fs.writeFileSync(path.join(wsDir, 'session.jsonl'), jsonl);

	// Set HOME so CLAUDE_PROJECTS resolves to our tmpDir
	process.env.HOME = tmpDir;
	({ getRelayStats } = await import('../src/lib/relayStats.js'));
});

after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getRelayStats: returns a stats object with expected shape', () => {
	const stats = getRelayStats();
	assert.ok(typeof stats === 'object' && stats !== null, 'stats is object');
	assert.ok(typeof stats.totalSessions === 'number');
	assert.ok(typeof stats.totalWorkspaces === 'number');
	assert.ok(typeof stats.totalTokens === 'number');
	assert.ok(typeof stats.totalOutput === 'number');
	assert.ok(typeof stats.totalToolCalls === 'number');
	assert.ok(typeof stats.avgDuration === 'number');
	assert.ok(typeof stats.avgContext === 'number');
	assert.ok(typeof stats.medianDuration === 'number');
	assert.ok(Array.isArray(stats.topTools));
	assert.ok(Array.isArray(stats.dailySessions));
});

test('getRelayStats: counts session from fixture', () => {
	const stats = getRelayStats();
	assert.ok(stats.totalSessions >= 1, `expected >=1 session, got ${stats.totalSessions}`);
});

test('getRelayStats: accumulates tokens from fixture', () => {
	const stats = getRelayStats();
	// turn1: input(1000) + cache_read(500) = 1500; turn2: input(500) = 500; total = 2000
	assert.ok(stats.totalTokens >= 2000, `expected >=2000 tokens, got ${stats.totalTokens}`);
	// output: turn1(200) + turn2(100) = 300
	assert.ok(stats.totalOutput >= 300, `expected >=300 output tokens, got ${stats.totalOutput}`);
});

test('getRelayStats: counts tool calls from fixture', () => {
	const stats = getRelayStats();
	assert.ok(stats.totalToolCalls >= 3, `expected >=3 tool calls, got ${stats.totalToolCalls}`);
});

test('getRelayStats: topTools includes Bash with correct count', () => {
	const stats = getRelayStats();
	const bash = stats.topTools.find(t => t.name === 'Bash');
	assert.ok(bash, 'Bash present in topTools');
	assert.ok(bash.count >= 2, `Bash count should be >=2, got ${bash.count}`);
});

test('getRelayStats: topTools includes Read', () => {
	const stats = getRelayStats();
	const read = stats.topTools.find(t => t.name === 'Read');
	assert.ok(read, 'Read present in topTools');
	assert.ok(read.count >= 1);
});

test('getRelayStats: topTools sorted by count descending', () => {
	const stats = getRelayStats();
	for (let i = 1; i < stats.topTools.length; i++) {
		assert.ok(
			stats.topTools[i - 1].count >= stats.topTools[i].count,
			`topTools[${i - 1}].count >= topTools[${i}].count`
		);
	}
});

test('getRelayStats: topTools limited to 15 entries', () => {
	const stats = getRelayStats();
	assert.ok(stats.topTools.length <= 15);
});

test('getRelayStats: dailySessions has exactly 14 entries', () => {
	const stats = getRelayStats();
	assert.equal(stats.dailySessions.length, 14);
});

test('getRelayStats: dailySessions entries have date and count fields', () => {
	const stats = getRelayStats();
	for (const entry of stats.dailySessions) {
		assert.ok(typeof entry.date === 'string', 'date is string');
		assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entry.date), `date format: ${entry.date}`);
		assert.ok(typeof entry.count === 'number', 'count is number');
	}
});

test('getRelayStats: dailySessions dates are ascending', () => {
	const stats = getRelayStats();
	for (let i = 1; i < stats.dailySessions.length; i++) {
		assert.ok(
			stats.dailySessions[i].date > stats.dailySessions[i - 1].date,
			`dates should be ascending: ${stats.dailySessions[i - 1].date} < ${stats.dailySessions[i].date}`
		);
	}
});

test('getRelayStats: firstSession and lastSession are ISO strings or null', () => {
	const stats = getRelayStats();
	if (stats.firstSession !== null) {
		assert.ok(typeof stats.firstSession === 'string');
		assert.ok(!isNaN(Date.parse(stats.firstSession)), `firstSession is valid date: ${stats.firstSession}`);
	}
	if (stats.lastSession !== null) {
		assert.ok(typeof stats.lastSession === 'string');
		assert.ok(!isNaN(Date.parse(stats.lastSession)), `lastSession is valid date: ${stats.lastSession}`);
	}
});

test('getRelayStats: avgDuration reflects session duration', () => {
	const stats = getRelayStats();
	// Our fixture is a 30-min session
	assert.ok(stats.avgDuration >= 1, `avgDuration should be >=1 min, got ${stats.avgDuration}`);
});

test('getRelayStats: returns cached result on second call', () => {
	const stats1 = getRelayStats();
	const stats2 = getRelayStats();
	// Should be the exact same object reference (cached)
	assert.equal(stats1, stats2, 'second call returns cached object');
});

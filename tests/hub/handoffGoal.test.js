/**
 * Tests for handoffGoal extraction in parseSessionStats.
 * extractMainGoal() is private — we test it via parseSessionStats()
 * by crafting JSONL fixtures with Write tool calls to HANDOFF.md.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let parseSessionStats;
let tmpDir;

function makeAssistantEntry(content, timestamp = '2026-01-01T10:00:00.000Z') {
	return JSON.stringify({
		type: 'assistant',
		timestamp,
		message: {
			usage: { input_tokens: 500, output_tokens: 100,
				cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
			content,
		},
	});
}

function makeWriteEntry(filePath, fileContent, timestamp = '2026-01-01T10:01:00.000Z') {
	return makeAssistantEntry([
		{ type: 'tool_use', id: 't1', name: 'Write',
			input: { file_path: filePath, content: fileContent } },
	], timestamp);
}

// A filler second entry (no text block) so file has >= 2 lines and >= 500 bytes
const FILLER = makeAssistantEntry(
	[{ type: 'tool_use', id: 'f1', name: 'Bash', input: { command: 'x'.repeat(200) } }],
	'2026-01-01T10:02:00.000Z',
);

function writeFixture(dir, name, lines) {
	const jsonl = [FILLER, ...lines].join('\n') + '\n';
	const p = path.join(dir, name);
	fs.writeFileSync(p, jsonl);
	return p;
}

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-goal-test-'));
	process.env.HOME = tmpDir;
	({ parseSessionStats } = await import('../../hub/src/lib/relayStats.js'));
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// ── Basic extraction ──────────────────────────────────────────────────────────

test('handoffGoal: extracted from ## MAIN GOAL heading', () => {
	const content = '## MAIN GOAL\nBuild the testing suite\n\n## other section\n';
	const p = writeFixture(tmpDir, 'basic.jsonl', [makeWriteEntry('/path/to/HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'Build the testing suite');
});

test('handoffGoal: works with bold markdown **MAIN GOAL**', () => {
	const content = '**MAIN GOAL**\n**Ship the feature**\n';
	const p = writeFixture(tmpDir, 'bold.jsonl', [makeWriteEntry('/path/HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'Ship the feature');
});

test('handoffGoal: strips leading markdown decorators (# - *)', () => {
	const content = '# MAIN GOAL\n- Fix the relay crash\n';
	const p = writeFixture(tmpDir, 'deco.jsonl', [makeWriteEntry('HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'Fix the relay crash');
});

test('handoffGoal: skips blank lines after heading', () => {
	const content = '## MAIN GOAL\n\nImprove hub performance\n';
	const p = writeFixture(tmpDir, 'blank.jsonl', [makeWriteEntry('HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'Improve hub performance');
});

test('handoffGoal: truncated to 120 chars', () => {
	const long = 'A'.repeat(200);
	const content = `## MAIN GOAL\n${long}\n`;
	const p = writeFixture(tmpDir, 'long.jsonl', [makeWriteEntry('HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal?.length, 120);
});

// ── File path matching ────────────────────────────────────────────────────────

test('handoffGoal: matches case-insensitive file path (handoff.md)', () => {
	const content = '## MAIN GOAL\nWrite more tests\n';
	const p = writeFixture(tmpDir, 'lower.jsonl', [makeWriteEntry('/some/dir/handoff.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'Write more tests');
});

test('handoffGoal: null when Write target is not a handoff file', () => {
	const content = '## MAIN GOAL\nThis should be ignored\n';
	const p = writeFixture(tmpDir, 'wrong-path.jsonl', [makeWriteEntry('/path/MEMORY.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, null);
});

// ── Fallback and edge cases ───────────────────────────────────────────────────

test('handoffGoal: null when no MAIN GOAL heading present', () => {
	const content = '## Status\nAll good\n## Next steps\nKeep going\n';
	const p = writeFixture(tmpDir, 'no-goal.jsonl', [makeWriteEntry('HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, null);
});

test('handoffGoal: null when MAIN GOAL heading has no content after it', () => {
	const content = '## MAIN GOAL\n';
	const p = writeFixture(tmpDir, 'empty-goal.jsonl', [makeWriteEntry('HANDOFF.md', content)]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, null);
});

test('handoffGoal: uses last Write to handoff file (most recent wins)', () => {
	const first = makeWriteEntry('HANDOFF.md', '## MAIN GOAL\nOld goal\n', '2026-01-01T10:00:00.000Z');
	const second = makeWriteEntry('HANDOFF.md', '## MAIN GOAL\nNew goal\n', '2026-01-01T10:05:00.000Z');
	const p = writeFixture(tmpDir, 'two-writes.jsonl', [first, second]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'New goal');
});

test('handoffGoal: does not affect firstText (both extracted independently)', () => {
	const textEntry = makeAssistantEntry([
		{ type: 'text', text: 'Working on the feature now.' },
	], '2026-01-01T10:00:00.000Z');
	const writeEntry = makeWriteEntry('HANDOFF.md', '## MAIN GOAL\nLaunch feature\n', '2026-01-01T10:01:00.000Z');
	const p = writeFixture(tmpDir, 'both.jsonl', [textEntry, writeEntry]);
	const s = parseSessionStats(p);
	assert.equal(s?.handoffGoal, 'Launch feature');
	assert.equal(s?.firstText, 'Working on the feature now.');
});

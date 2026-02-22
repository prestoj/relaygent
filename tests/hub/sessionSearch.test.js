/**
 * Tests for hub/src/lib/sessionSearch.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpHome, origHome;

before(() => {
	origHome = process.env.HOME;
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-search-test-'));
	process.env.HOME = tmpHome;
	fs.mkdirSync(path.join(tmpHome, '.claude', 'projects'), { recursive: true });
});

after(() => {
	process.env.HOME = origHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

const { searchSessions } = await import('../../hub/src/lib/sessionSearch.js');

/** Create a fake session dir with a JSONL file (padded to >200 bytes) */
function makeSession(id, lines, uuid = 'aabb1122') {
	const dir = path.join(tmpHome, '.claude', 'projects', `proj-${id}`);
	fs.mkdirSync(dir, { recursive: true });
	const pad = JSON.stringify({ type: 'padding', data: 'x'.repeat(300) });
	fs.writeFileSync(path.join(dir, `${uuid}.jsonl`), [pad, ...lines].join('\n') + '\n', 'utf-8');
}

const assistantMsg = (text) => JSON.stringify({
	type: 'assistant', message: { content: [{ type: 'text', text }] }
});

test('searchSessions: empty query returns empty array', () => {
	assert.deepEqual(searchSessions(''), []);
});

test('searchSessions: single-char query returns empty array', () => {
	assert.deepEqual(searchSessions('x'), []);
});

test('searchSessions: finds match in assistant text', () => {
	makeSession('2026-02-01-10-00-00', [assistantMsg('Found the unique_tok_abc in the code.')]);
	const results = searchSessions('unique_tok_abc');
	assert.ok(results.length >= 1);
	const match = results.find(r => r.id === '2026-02-01-10-00-00--aabb1122');
	assert.ok(match, 'should find session by new ID format');
	assert.equal(match.type, 'session');
	assert.ok(match.snippet.includes('unique_tok_abc'));
});

test('searchSessions: no match returns empty', () => {
	const results = searchSessions('zzz_not_present_zzz');
	assert.equal(results.length, 0);
});

test('searchSessions: one result per session even with multiple matches', () => {
	makeSession('2026-02-02-11-00-00', [
		assistantMsg('alpha_dedup appears once.'),
		assistantMsg('alpha_dedup appears twice.'),
	]);
	const matches = searchSessions('alpha_dedup').filter(r => r.id === '2026-02-02-11-00-00--aabb1122');
	assert.equal(matches.length, 1);
});

test('searchSessions: result has correct displayTime', () => {
	makeSession('2026-02-03-09-30-00', [assistantMsg('display_time_tok is here.')]);
	const results = searchSessions('display_time_tok');
	const match = results.find(r => r.id === '2026-02-03-09-30-00--aabb1122');
	assert.ok(match);
	assert.equal(match.displayTime, '2026-02-03 09:30');
});

test('searchSessions: respects maxResults limit', () => {
	for (let h = 0; h < 10; h++) {
		const hour = String(h).padStart(2, '0');
		makeSession(`2026-02-04-${hour}-00-00`, [assistantMsg(`limit_tok_xyz session ${h}`)]);
	}
	const results = searchSessions('limit_tok_xyz', 3);
	assert.ok(results.length <= 3);
});

test('searchSessions: finds match in malformed JSONL line (fallback snippet path)', () => {
	// A line that is not valid JSON but contains the query — exercises extractSnippet fallback (lines 28-30)
	const dir = path.join(tmpHome, '.claude', 'projects', 'proj-2026-02-05-12-00-00');
	fs.mkdirSync(dir, { recursive: true });
	const pad = JSON.stringify({ type: 'padding', data: 'x'.repeat(300) });
	const badLine = 'not-json but contains fallback_unique_tok_xyz here';
	fs.writeFileSync(path.join(dir, 'ccdd5566.jsonl'), [pad, badLine].join('\n') + '\n', 'utf-8');
	const results = searchSessions('fallback_unique_tok_xyz');
	assert.ok(results.length >= 1);
	assert.ok(results[0].snippet.includes('fallback_unique_tok_xyz'));
});

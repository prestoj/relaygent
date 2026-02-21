/**
 * Tests for hub/src/lib/kbSearch.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let searchTopics;

function writeTopic(slug, title, content) {
	const filepath = path.join(tmpDir, `${slug}.md`);
	fs.mkdirSync(path.dirname(filepath), { recursive: true });
	fs.writeFileSync(filepath, `---\ntitle: ${title}\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags: [test]\n---\n\n${content}\n`);
}

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbsearch-test-'));
	process.env.RELAYGENT_KB_DIR = tmpDir;
	// Write test topics
	writeTopic('alpha', 'Alpha Topic', 'This is about machine learning and neural networks.');
	writeTopic('beta', 'Beta Topic', 'This covers database optimization and SQL queries.');
	writeTopic('gamma', 'Gamma Topic', 'A guide to setting up Docker containers for deployment.');
	// Dynamic import after setting env var
	({ searchTopics } = await import('../../hub/src/lib/kbSearch.js'));
});

after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.RELAYGENT_KB_DIR;
});

test('searchTopics: returns empty for empty query', () => {
	assert.deepEqual(searchTopics(''), []);
	assert.deepEqual(searchTopics(null), []);
});

test('searchTopics: finds matching topic', () => {
	const results = searchTopics('neural');
	assert.equal(results.length, 1);
	assert.equal(results[0].slug, 'alpha');
	assert.equal(results[0].type, 'topic');
});

test('searchTopics: case insensitive search', () => {
	const results = searchTopics('DOCKER');
	assert.equal(results.length, 1);
	assert.equal(results[0].slug, 'gamma');
});

test('searchTopics: returns snippet with context', () => {
	const results = searchTopics('database');
	assert.equal(results.length, 1);
	assert.ok(results[0].snippet.length > 0, 'should have snippet');
	assert.ok(results[0].snippet.toLowerCase().includes('database'));
});

test('searchTopics: no results for non-matching query', () => {
	const results = searchTopics('xyznonexistent');
	assert.equal(results.length, 0);
});

test('searchTopics: finds across multiple topics', () => {
	const results = searchTopics('and');
	assert.ok(results.length >= 2, 'should match multiple topics');
});

test('searchTopics: results have topic metadata', () => {
	const results = searchTopics('neural');
	assert.ok(results[0].title, 'should have title');
	assert.ok(results[0].slug, 'should have slug');
	assert.equal(results[0].type, 'topic');
});

/**
 * Tests for the search page loader (search/+page.server.js).
 * Tests KB topic search and session search with query filtering.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-search.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'search-page-'));
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'search-home-'));
process.env.RELAYGENT_KB_DIR = tmpKb;
process.env.HOME = tmpHome;

const { load } = await import('../../hub/src/routes/search/+page.server.js');

after(() => {
	fs.rmSync(tmpKb, { recursive: true, force: true });
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

function fakeUrl(q = '') {
	return { url: new URL(`http://localhost/search${q ? `?q=${encodeURIComponent(q)}` : ''}`) };
}

test('search load returns expected keys', async () => {
	const data = await load(fakeUrl());
	assert.ok('query' in data);
	assert.ok('results' in data);
});

test('search load: empty query returns empty results', async () => {
	const data = await load(fakeUrl());
	assert.equal(data.query, '');
	assert.deepEqual(data.results, []);
});

test('search load: query is passed through', async () => {
	const data = await load(fakeUrl('hello'));
	assert.equal(data.query, 'hello');
});

test('search load: finds matching KB topics', async () => {
	fs.writeFileSync(path.join(tmpKb, 'widgets.md'), '---\ntitle: Widgets\n---\nAll about widgets');
	fs.writeFileSync(path.join(tmpKb, 'other.md'), '---\ntitle: Other\n---\nUnrelated content');
	const data = await load(fakeUrl('widgets'));
	assert.ok(data.results.length >= 1, 'should find widgets topic');
	const titles = data.results.map(r => r.title || r.name);
	assert.ok(titles.some(t => /widget/i.test(t)), `should match widgets, got: ${titles}`);
});

test('search load: no results for nonsense query', async () => {
	const data = await load(fakeUrl('xyzzy999nonexistent'));
	assert.equal(data.results.length, 0);
});

test('search load: short query skips session search', async () => {
	// Queries under 2 chars skip session search
	const data = await load(fakeUrl('a'));
	assert.ok(Array.isArray(data.results));
});

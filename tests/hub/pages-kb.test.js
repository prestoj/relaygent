/**
 * Tests for the KB page loader (kb/+page.server.js).
 * Tests topic listing, tag filtering, daily log separation, and dead links.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-kb.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-page-'));
process.env.RELAYGENT_KB_DIR = tmpKb;

const { load } = await import('../../hub/src/routes/kb/+page.server.js');

after(() => fs.rmSync(tmpKb, { recursive: true, force: true }));

function writeTopic(slug, { title, tags, content } = {}) {
	const t = title || slug;
	const tagLine = tags ? `tags: [${tags.join(', ')}]` : '';
	fs.writeFileSync(path.join(tmpKb, `${slug}.md`), [
		'---', `title: ${t}`, tagLine, '---', content || 'Content',
	].filter(Boolean).join('\n'));
}

function fakeUrl(queryString = '') {
	return { url: new URL(`http://localhost/kb${queryString}`) };
}

function clearKb() {
	for (const f of fs.readdirSync(tmpKb)) {
		fs.unlinkSync(path.join(tmpKb, f));
	}
}

// --- Basic shape ---

test('KB load returns expected keys', () => {
	clearKb();
	const data = load(fakeUrl());
	assert.ok('topics' in data);
	assert.ok('dailyLogs' in data);
	assert.ok('allTags' in data);
	assert.ok('activeTag' in data);
	assert.ok('deadLinks' in data);
});

test('KB load: empty dir returns empty arrays', () => {
	clearKb();
	const data = load(fakeUrl());
	assert.deepEqual(data.topics, []);
	assert.deepEqual(data.dailyLogs, []);
	assert.deepEqual(data.allTags, []);
	assert.equal(data.activeTag, null);
});

// --- Topic listing ---

test('KB load: lists regular topics', () => {
	clearKb();
	writeTopic('my-topic', { title: 'My Topic' });
	const data = load(fakeUrl());
	assert.equal(data.topics.length, 1);
	assert.equal(data.topics[0].title, 'My Topic');
});

// --- Daily logs separated ---

test('KB load: daily logs separated from topics', () => {
	clearKb();
	writeTopic('my-topic', { title: 'Regular' });
	writeTopic('2026-02-20', { title: 'Daily Log' });
	const data = load(fakeUrl());
	assert.equal(data.topics.length, 1);
	assert.equal(data.dailyLogs.length, 1);
	assert.equal(data.topics[0].title, 'Regular');
	assert.equal(data.dailyLogs[0].slug, '2026-02-20');
});

// --- Tag filtering ---

test('KB load: allTags collected from topics', () => {
	clearKb();
	writeTopic('a', { tags: ['meta', 'tools'] });
	writeTopic('b', { tags: ['tools', 'code'] });
	const data = load(fakeUrl());
	assert.deepEqual(data.allTags, ['code', 'meta', 'tools']);
});

test('KB load: tag filter returns matching topics only', () => {
	clearKb();
	writeTopic('a', { title: 'A', tags: ['meta'] });
	writeTopic('b', { title: 'B', tags: ['code'] });
	const data = load(fakeUrl('?tag=meta'));
	assert.equal(data.topics.length, 1);
	assert.equal(data.topics[0].title, 'A');
	assert.equal(data.activeTag, 'meta');
});

test('KB load: tag filter with no matches returns empty', () => {
	clearKb();
	writeTopic('a', { title: 'A', tags: ['meta'] });
	const data = load(fakeUrl('?tag=nonexistent'));
	assert.equal(data.topics.length, 0);
	assert.equal(data.activeTag, 'nonexistent');
});

// --- Dead links ---

test('KB load: dead links detected for broken wiki-links', () => {
	clearKb();
	writeTopic('source', { content: 'See [[nonexistent-topic]] for details' });
	const data = load(fakeUrl());
	assert.ok(data.deadLinks.length > 0, 'should detect dead link');
});

test('KB load: no dead links when all links resolve', () => {
	clearKb();
	writeTopic('source', { content: 'See [[target]] for details' });
	writeTopic('target', { title: 'Target' });
	const data = load(fakeUrl());
	assert.equal(data.deadLinks.length, 0);
});

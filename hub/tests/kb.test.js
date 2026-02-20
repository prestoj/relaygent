/**
 * Tests for hub/src/lib/kb.js
 * Run with: node --test hub/tests/kb.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set RELAYGENT_KB_DIR before importing kb.js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
process.env.RELAYGENT_KB_DIR = tmpDir;

const { listTopics, getTopic, saveTopic, deleteTopic, searchTopics, getKbDir, findDeadLinks } =
    await import('../src/lib/kb.js');

after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeTopic(filename, content) {
    fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');
}

test('getKbDir: returns the configured KB directory', () => {
    assert.equal(getKbDir(), tmpDir);
});

test('listTopics: empty dir returns empty array', () => {
    assert.deepEqual(listTopics(), []);
});

test('listTopics: returns topic with metadata', () => {
    writeTopic('hello.md', '---\ntitle: Hello World\ncreated: 2026-01-01\n---\n\nContent here.\n');
    const topics = listTopics();
    assert.ok(topics.some(t => t.slug === 'hello'));
    const t = topics.find(t => t.slug === 'hello');
    assert.equal(t.title, 'Hello World');
});

test('listTopics: sorts by updated date descending', () => {
    writeTopic('older.md', '---\ntitle: Older\nupdated: 2026-01-01\n---\n\nOld.\n');
    writeTopic('newer.md', '---\ntitle: Newer\nupdated: 2026-02-01\n---\n\nNew.\n');
    const topics = listTopics();
    const slugs = topics.map(t => t.slug);
    assert.ok(slugs.indexOf('newer') < slugs.indexOf('older'));
});

test('getTopic: returns null for missing topic', () => {
    assert.equal(getTopic('does-not-exist'), null);
});

test('getTopic: returns rendered HTML', () => {
    writeTopic('sample.md', '---\ntitle: Sample\n---\n\n# Hello\n\nSome **bold** text.\n');
    const topic = getTopic('sample');
    assert.ok(topic);
    assert.equal(topic.slug, 'sample');
    assert.equal(topic.title, 'Sample');
    assert.ok(topic.html.includes('<strong>bold</strong>'));
});

test('getTopic: renders wiki-links as anchor tags', () => {
    writeTopic('linker.md', '---\ntitle: Linker\n---\n\nSee [[sample]] for details.\n');
    const topic = getTopic('linker');
    assert.ok(topic.html.includes('href="/kb/sample"'));
    assert.ok(topic.html.includes('class="wiki-link"'));
});

test('getTopic: renders wiki-links with display text [[slug|label]]', () => {
    writeTopic('linker2.md', '---\ntitle: Linker2\n---\n\nSee [[sample|the sample page]].\n');
    const topic = getTopic('linker2');
    assert.ok(topic.html.includes('href="/kb/sample"'));
    assert.ok(topic.html.includes('the sample page'));
});

test('getTopic: finds backlinks from other topics', () => {
    writeTopic('target.md', '---\ntitle: Target\n---\n\nI am the target.\n');
    writeTopic('source.md', '---\ntitle: Source\n---\n\nPoints to [[target]].\n');
    const topic = getTopic('target');
    assert.ok(topic.backlinks.some(b => b.slug === 'source'));
});

test('getTopic: path traversal rejected', () => {
    assert.throws(() => getTopic('../../../etc/passwd'), /Invalid slug/);
});

test('saveTopic: writes file and updates timestamp', () => {
    saveTopic('saved', { title: 'Saved Topic', created: '2026-01-01' }, 'Hello content.');
    const raw = fs.readFileSync(path.join(tmpDir, 'saved.md'), 'utf-8');
    assert.ok(raw.includes('title: Saved Topic'));
    assert.ok(raw.includes('Hello content.'));
    const today = new Date().toISOString().split('T')[0];
    // gray-matter may quote the date: updated: '2026-...' or updated: 2026-...
    assert.ok(raw.includes(`updated: ${today}`) || raw.includes(`updated: '${today}'`));
});

test('saveTopic: overwrites existing topic', () => {
    saveTopic('overwrite', { title: 'V1' }, 'Version 1.');
    saveTopic('overwrite', { title: 'V2' }, 'Version 2.');
    const topic = getTopic('overwrite');
    assert.equal(topic.title, 'V2');
    assert.ok(topic.html.includes('Version 2'));
});

test('searchTopics: finds topic by content', () => {
    writeTopic('findme.md', '---\ntitle: FindMe\n---\n\nThis has a unique_search_token_xyz in it.\n');
    const results = searchTopics('unique_search_token_xyz');
    assert.ok(results.some(r => r.slug === 'findme'));
});

test('searchTopics: returns empty for no match', () => {
    const results = searchTopics('zzznonexistentqueryzzzz');
    assert.equal(results.length, 0);
});

test('searchTopics: empty query returns empty array', () => {
    assert.deepEqual(searchTopics(''), []);
});

test('searchTopics: includes snippet with context', () => {
    writeTopic('snip.md', '---\ntitle: Snip\n---\n\nBefore context. search_term_abc here. After context.\n');
    const results = searchTopics('search_term_abc');
    assert.ok(results.length > 0);
    assert.ok(results[0].snippet.includes('search_term_abc'));
});

test('findDeadLinks: returns empty array when no broken links', () => {
    writeTopic('a.md', '---\ntitle: A\n---\n\nSee [[b]] here.\n');
    writeTopic('b.md', '---\ntitle: B\n---\n\nNo links.\n');
    const dead = findDeadLinks();
    assert.ok(!dead.some(d => d.source === 'a' && d.target === 'b'));
});

test('findDeadLinks: reports missing link target', () => {
    writeTopic('broken.md', '---\ntitle: Broken\n---\n\nSee [[does-not-exist-xyz]] here.\n');
    const dead = findDeadLinks();
    assert.ok(dead.some(d => d.source === 'broken' && d.target === 'does-not-exist-xyz'));
});

test('findDeadLinks: deduplicates same source→target pair', () => {
    writeTopic('dup.md', '---\ntitle: Dup\n---\n\n[[missing-xyz]] and [[missing-xyz]] again.\n');
    const dead = findDeadLinks().filter(d => d.source === 'dup' && d.target === 'missing-xyz');
    assert.equal(dead.length, 1);
});

test('findDeadLinks: handles pipe syntax [[slug|display]]', () => {
    writeTopic('piped.md', '---\ntitle: Piped\n---\n\nSee [[ghost-topic|Ghost Page]] here.\n');
    const dead = findDeadLinks();
    const match = dead.find(d => d.source === 'piped' && d.target === 'ghost-topic');
    assert.ok(match);
    assert.equal(match.display, 'Ghost Page');
});

test('deleteTopic: removes the topic file', () => {
    writeTopic('to-delete.md', '---\ntitle: Delete Me\n---\n\nContent.\n');
    assert.ok(getTopic('to-delete'));
    deleteTopic('to-delete');
    assert.equal(getTopic('to-delete'), null);
});

test('deleteTopic: throws for missing topic', () => {
    assert.throws(() => deleteTopic('no-such-topic-xyz'), /Topic not found/);
});

test('deleteTopic: rejects path traversal', () => {
    assert.throws(() => deleteTopic('../../../etc/passwd'), /Invalid slug/);
});

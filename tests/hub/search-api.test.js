/**
 * Tests for /api/search — lightweight KB search for command palette.
 * Creates temp KB dir with test files, sets RELAYGENT_KB_DIR before import.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-search-'));
const topics = [
	{ slug: 'handoff', title: 'Handoff', tags: ['meta'], body: 'Session handoff notes.' },
	{ slug: 'memory', title: 'Memory', tags: ['meta'], body: 'Agent persistent memory.' },
	{ slug: 'relay', title: 'Relay Architecture', tags: ['system'], body: 'How the relay loop works.' },
];
for (const t of topics) {
	const content = `---\ntitle: ${t.title}\ntags: [${t.tags.join(', ')}]\n---\n\n${t.body}\n`;
	fs.writeFileSync(path.join(tmpDir, `${t.slug}.md`), content);
}
process.env.RELAYGENT_KB_DIR = tmpDir;

const { GET } = await import('../../hub/src/routes/api/search/+server.js');
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function searchReq(q) {
	const u = new URL('http://localhost/api/search');
	if (q) u.searchParams.set('q', q);
	return { url: u };
}

test('returns empty for short queries', async () => {
	const res = await GET(searchReq('a'));
	const body = await res.json();
	assert.deepEqual(body.results, []);
});

test('returns empty for empty query', async () => {
	const res = await GET(searchReq(''));
	const body = await res.json();
	assert.deepEqual(body.results, []);
});

test('finds topics matching query', async () => {
	const res = await GET(searchReq('relay'));
	const body = await res.json();
	assert.ok(body.results.length >= 1);
	assert.ok(body.results.some(r => r.slug === 'relay'));
});

test('search is case-insensitive', async () => {
	const res = await GET(searchReq('HANDOFF'));
	const body = await res.json();
	assert.ok(body.results.some(r => r.slug === 'handoff'));
});

test('returns title and slug for each result', async () => {
	const res = await GET(searchReq('memory'));
	const body = await res.json();
	const hit = body.results.find(r => r.slug === 'memory');
	assert.ok(hit);
	assert.equal(hit.title, 'Memory');
	assert.ok(Array.isArray(hit.tags));
});

test('limits results to 8', async () => {
	const res = await GET(searchReq('meta'));
	const body = await res.json();
	assert.ok(body.results.length <= 8);
});

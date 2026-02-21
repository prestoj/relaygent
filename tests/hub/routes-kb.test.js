/**
 * Tests for hub/src/routes/kb/[...slug]/+page.server.js
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/routes-kb.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-route-test-'));
process.env.RELAYGENT_KB_DIR = tmpDir;

const { load, actions } = await import('../../hub/src/routes/kb/[...slug]/+page.server.js');
const { getTopic } = await import('../../hub/src/lib/kb.js');

after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeTopic(filename, content) {
	fs.writeFileSync(path.join(tmpDir, filename), content, 'utf-8');
}

function formReq(slug, fields) {
	const formData = new FormData();
	for (const [k, v] of Object.entries(fields)) formData.set(k, v);
	return { params: { slug }, request: new Request('http://localhost/', { method: 'POST', body: formData }) };
}

test('load: returns topic null for missing slug', () => {
	const result = load({ params: { slug: 'does-not-exist-abc' } });
	assert.equal(result.topic, null);
	assert.equal(result.slug, 'does-not-exist-abc');
	assert.equal(result.rawContent, '');
});

test('load: throws 400 for path traversal', () => {
	assert.throws(() => load({ params: { slug: '../../../etc/passwd' } }), { status: 400 });
});

test('load: returns topic and rawContent for existing topic', () => {
	writeTopic('existing.md', '---\ntitle: Existing\n---\n\nHello.\n');
	const result = load({ params: { slug: 'existing' } });
	assert.ok(result.topic);
	assert.equal(result.topic.title, 'Existing');
	assert.ok(result.rawContent.includes('Hello.'));
});

test('save action: creates new topic that did not exist', async () => {
	const result = await actions.save(formReq('brand-new-topic', {
		title: 'Brand New Topic',
		content: 'Initial content.'
	}));
	assert.deepEqual(result, { success: true });
	const topic = getTopic('brand-new-topic');
	assert.ok(topic);
	assert.equal(topic.title, 'Brand New Topic');
	assert.ok(topic.html.includes('Initial content.'));
});

test('save action: new topic uses slug as title fallback', async () => {
	const result = await actions.save(formReq('slug-as-title', {
		title: '',
		content: 'No title provided.'
	}));
	assert.deepEqual(result, { success: true });
	const topic = getTopic('slug-as-title');
	assert.ok(topic);
	assert.equal(topic.title, 'slug-as-title');
});

test('save action: preserves existing frontmatter on edit', async () => {
	writeTopic('has-tags.md', '---\ntitle: Has Tags\ntags: [foo, bar]\ncreated: 2026-01-01\n---\n\nOriginal.\n');
	await actions.save(formReq('has-tags', { content: 'Updated.' }));
	const topic = getTopic('has-tags');
	assert.ok(topic.tags?.includes('foo'));
	assert.ok(topic.html.includes('Updated.'));
});

test('save action: rejects path traversal', async () => {
	await assert.rejects(
		() => actions.save(formReq('../../../evil', { title: 'x', content: 'y' })),
		{ status: 400 }
	);
});

test('delete action: removes topic and redirects to /kb', async () => {
	writeTopic('del-me.md', '---\ntitle: Del Me\n---\n\nBye.\n');
	let redirected = false;
	try {
		await actions.delete({ params: { slug: 'del-me' } });
	} catch (e) {
		if (e?.status === 303 && e?.location === '/kb') redirected = true;
		else throw e;
	}
	assert.ok(redirected, 'should redirect to /kb');
	assert.equal(getTopic('del-me'), null);
});

test('delete action: throws 404 for missing topic', async () => {
	await assert.rejects(
		() => actions.delete({ params: { slug: 'never-existed-xyz' } }),
		{ status: 404 }
	);
});

test('delete action: rejects path traversal', async () => {
	await assert.rejects(
		() => actions.delete({ params: { slug: '../../../etc/passwd' } }),
		{ status: 400 }
	);
});

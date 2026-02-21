/**
 * Tests for the intent page loader and save action (intent/+page.server.js).
 * Tests loading + rendering INTENT.md, 404 on missing, and save action.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-intent.test.js
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-page-'));
process.env.RELAYGENT_KB_DIR = tmpKb;

const { load, actions } = await import('../../hub/src/routes/intent/+page.server.js');

after(() => fs.rmSync(tmpKb, { recursive: true, force: true }));

const INTENT_PATH = path.join(tmpKb, 'INTENT.md');

function writeIntent(content, frontmatter = {}) {
	const fm = { title: 'Intent', ...frontmatter };
	const lines = ['---'];
	for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
	lines.push('---', content);
	fs.writeFileSync(INTENT_PATH, lines.join('\n'));
}

// --- load() ---

test('intent load: returns expected keys', () => {
	writeIntent('My priorities here');
	const data = load();
	assert.ok('title' in data);
	assert.ok('updated' in data);
	assert.ok('html' in data);
	assert.ok('rawContent' in data);
});

test('intent load: renders markdown to html', () => {
	writeIntent('## Priorities\n\n- Build stuff\n- Ship it');
	const data = load();
	assert.ok(data.html.includes('Priorities'), 'should contain heading');
	assert.ok(data.html.includes('Build stuff'), 'should contain list item');
});

test('intent load: extracts frontmatter title', () => {
	writeIntent('Content', { title: 'My Intent' });
	const data = load();
	assert.equal(data.title, 'My Intent');
});

test('intent load: extracts updated date', () => {
	writeIntent('Content', { updated: '2026-02-20' });
	const data = load();
	// gray-matter parses date strings into Date objects
	const val = data.updated instanceof Date ? data.updated.toISOString().split('T')[0] : String(data.updated);
	assert.equal(val, '2026-02-20');
});

test('intent load: rawContent excludes frontmatter', () => {
	writeIntent('Just the body text');
	const data = load();
	assert.ok(data.rawContent.includes('Just the body text'));
	assert.ok(!data.rawContent.includes('---'));
});

test('intent load: throws 404 when INTENT.md missing', () => {
	try { fs.unlinkSync(INTENT_PATH); } catch { /* ok */ }
	try {
		load();
		assert.fail('should have thrown');
	} catch (e) {
		assert.equal(e.status, 404);
	}
});

test('intent load: sanitizes HTML (no script tags)', () => {
	writeIntent('<script>alert("xss")</script>Hello');
	const data = load();
	assert.ok(!data.html.includes('<script>'), 'should strip script tags');
	assert.ok(data.html.includes('Hello'), 'should keep safe content');
});

// --- save action ---

test('intent save: updates file content', async () => {
	writeIntent('Old content', { title: 'Intent', updated: '2026-01-01' });
	const formData = new FormData();
	formData.set('content', 'New content from user');
	const result = await actions.save({
		request: new Request('http://localhost/intent', {
			method: 'POST', body: formData,
		}),
	});
	assert.deepEqual(result, { success: true });
	const raw = fs.readFileSync(INTENT_PATH, 'utf-8');
	assert.ok(raw.includes('New content from user'));
});

test('intent save: updates the updated date in frontmatter', async () => {
	writeIntent('Content', { title: 'Intent', updated: '2020-01-01' });
	const formData = new FormData();
	formData.set('content', 'Updated body');
	await actions.save({
		request: new Request('http://localhost/intent', {
			method: 'POST', body: formData,
		}),
	});
	const raw = fs.readFileSync(INTENT_PATH, 'utf-8');
	const today = new Date().toISOString().split('T')[0];
	assert.ok(raw.includes(today), `should have today's date, got: ${raw.slice(0, 100)}`);
});

test('intent save: preserves frontmatter title', async () => {
	writeIntent('Content', { title: "'My Intent'" });
	const formData = new FormData();
	formData.set('content', 'New body');
	await actions.save({
		request: new Request('http://localhost/intent', {
			method: 'POST', body: formData,
		}),
	});
	const raw = fs.readFileSync(INTENT_PATH, 'utf-8');
	assert.ok(raw.includes('My Intent'), 'title should be preserved');
});

test('intent save: throws 404 when INTENT.md missing', async () => {
	try { fs.unlinkSync(INTENT_PATH); } catch { /* ok */ }
	const formData = new FormData();
	formData.set('content', 'test');
	try {
		await actions.save({
			request: new Request('http://localhost/intent', {
				method: 'POST', body: formData,
			}),
		});
		assert.fail('should have thrown');
	} catch (e) {
		assert.equal(e.status, 404);
	}
});

/**
 * Tests for the layout server loader (+layout.server.js).
 * Returns dueTasks count and deadKbLinks count for nav badges.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-layout.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-page-'));
process.env.RELAYGENT_KB_DIR = tmpKb;

const { load } = await import('../../hub/src/routes/+layout.server.js');

after(() => fs.rmSync(tmpKb, { recursive: true, force: true }));

test('layout load returns expected keys', async () => {
	const data = await load();
	assert.ok('dueTasks' in data);
	assert.ok('deadKbLinks' in data);
});

test('layout load: dueTasks is 0 with no tasks file', async () => {
	const data = await load();
	assert.equal(data.dueTasks, 0);
});

test('layout load: dueTasks counts due recurring tasks', async () => {
	const old = new Date(Date.now() - 48 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
	fs.writeFileSync(path.join(tmpKb, 'tasks.md'), [
		`- [ ] Due task | type: recurring | freq: daily | last: ${old}`,
		'- [ ] Not due | type: recurring | freq: daily | last: never',
		'- [ ] One-off | type: one-off',
	].join('\n'));
	const data = await load();
	assert.ok(data.dueTasks >= 1, `expected at least 1 due task, got ${data.dueTasks}`);
	fs.unlinkSync(path.join(tmpKb, 'tasks.md'));
});

test('layout load: deadKbLinks is 0 with no topics', async () => {
	const data = await load();
	assert.equal(data.deadKbLinks, 0);
});

test('layout load: deadKbLinks detects broken wiki-links', async () => {
	fs.writeFileSync(path.join(tmpKb, 'source.md'), '---\ntitle: Source\n---\nSee [[broken-link]]');
	const data = await load();
	assert.ok(data.deadKbLinks >= 1, `expected dead links, got ${data.deadKbLinks}`);
	fs.unlinkSync(path.join(tmpKb, 'source.md'));
});

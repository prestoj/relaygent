/**
 * Tests for the tasks page loader (tasks/+page.server.js).
 * Tests recurring/oneoff split, sorting, and now timestamp.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-tasks.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpKb = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-page-'));
process.env.RELAYGENT_KB_DIR = tmpKb;

const { load } = await import('../../hub/src/routes/tasks/+page.server.js');

after(() => fs.rmSync(tmpKb, { recursive: true, force: true }));

function writeTasks(content) {
	fs.writeFileSync(path.join(tmpKb, 'tasks.md'), content);
}

test('tasks page load returns expected keys', async () => {
	writeTasks('');
	const data = await load();
	assert.ok('recurring' in data);
	assert.ok('oneoff' in data);
	assert.ok('now' in data);
});

test('tasks page load: now is a valid ISO timestamp', async () => {
	writeTasks('');
	const data = await load();
	assert.ok(!isNaN(new Date(data.now).getTime()), 'now should be valid ISO');
});

test('tasks page load: splits recurring and oneoff tasks', async () => {
	writeTasks([
		'- [ ] Build thing | type: one-off',
		'- [ ] Commit KB | type: recurring | freq: daily | last: never',
		'- [ ] Fix bug | type: one-off',
	].join('\n'));
	const data = await load();
	assert.equal(data.recurring.length, 1);
	assert.equal(data.oneoff.length, 2);
	assert.equal(data.recurring[0].description, 'Commit KB');
});

test('tasks page load: recurring sorted with due first', async () => {
	const old = new Date(Date.now() - 48 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
	const recent = new Date(Date.now() - 1000).toISOString().slice(0, 16).replace('T', ' ');
	writeTasks([
		`- [ ] Not due | type: recurring | freq: daily | last: ${recent}`,
		`- [ ] Overdue | type: recurring | freq: daily | last: ${old}`,
	].join('\n'));
	const data = await load();
	assert.equal(data.recurring[0].description, 'Overdue', 'due task should come first');
});

test('tasks page load: empty file returns empty arrays', async () => {
	writeTasks('');
	const data = await load();
	assert.deepEqual(data.recurring, []);
	assert.deepEqual(data.oneoff, []);
});

test('tasks page load: missing file returns empty arrays', async () => {
	try { fs.unlinkSync(path.join(tmpKb, 'tasks.md')); } catch { /* ok */ }
	const data = await load();
	assert.deepEqual(data.recurring, []);
	assert.deepEqual(data.oneoff, []);
});

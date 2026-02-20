/**
 * Tests for hub/src/lib/tasks.js
 * Run with: node --test hub/tests/tasks.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadTasks, addTask, removeTask, editTask, completeTask } from '../src/lib/tasks.js';

function makeTempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test-'));
	return dir;
}

function writeTasks(dir, content) {
	fs.writeFileSync(path.join(dir, 'tasks.md'), content, 'utf-8');
}

function readTasks(dir) {
	return fs.readFileSync(path.join(dir, 'tasks.md'), 'utf-8');
}

test('loadTasks: empty file returns empty list', () => {
	const dir = makeTempDir();
	writeTasks(dir, '---\ntitle: Tasks\nupdated: 2026-01-01\n---\n\n## Tasks\n\n');
	const { tasks } = loadTasks(dir);
	assert.equal(tasks.length, 0);
});

test('loadTasks: parses one-off task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Fix the bug | type: one-off\n');
	const { tasks } = loadTasks(dir);
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0].description, 'Fix the bug');
	assert.equal(tasks[0].type, 'one-off');
});

test('loadTasks: parses recurring task with last: never', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Commit KB | type: recurring | freq: 12h | last: never\n');
	const { tasks } = loadTasks(dir);
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0].type, 'recurring');
	assert.equal(tasks[0].freq, '12h');
	assert.equal(tasks[0].last, 'never');
	assert.equal(tasks[0].due, true); // never done = overdue
});

test('loadTasks: recurring task not yet due', () => {
	const dir = makeTempDir();
	// last done 1 minute ago, freq 12h — not due yet
	const recent = new Date(Date.now() - 60000).toISOString().slice(0, 16).replace('T', ' ');
	writeTasks(dir, `- [ ] Commit KB | type: recurring | freq: 12h | last: ${recent}\n`);
	const { tasks } = loadTasks(dir);
	assert.equal(tasks[0].due, false);
	assert.equal(tasks[0].minsLate, null);
});

test('loadTasks: recurring task overdue', () => {
	const dir = makeTempDir();
	// last done 3 days ago, freq daily — definitely overdue regardless of timezone
	const old = new Date(Date.now() - 3 * 24 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
	writeTasks(dir, `- [ ] Commit KB | type: recurring | freq: daily | last: ${old}\n`);
	const { tasks } = loadTasks(dir);
	assert.equal(tasks[0].due, true);
	assert(tasks[0].minsLate > 0);
});

test('addTask: appends one-off task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '---\nupdated: 2026-01-01\n---\n\n## Tasks\n\n');
	const ok = addTask(dir, 'Write tests');
	assert.equal(ok, true);
	const raw = readTasks(dir);
	assert(raw.includes('- [ ] Write tests | type: one-off'));
});

test('addTask: updates timestamp', () => {
	const dir = makeTempDir();
	writeTasks(dir, '---\nupdated: 2026-01-01\n---\n\n## Tasks\n\n');
	addTask(dir, 'Something');
	const raw = readTasks(dir);
	const today = new Date().toISOString().slice(0, 10);
	assert(raw.includes(`updated: ${today}`));
});

test('removeTask: removes one-off task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Fix the bug | type: one-off\n- [ ] Other task | type: one-off\n');
	const ok = removeTask(dir, 'Fix the bug');
	assert.equal(ok, true);
	const raw = readTasks(dir);
	assert(!raw.includes('Fix the bug'));
	assert(raw.includes('Other task'));
});

test('removeTask: removes recurring tasks', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Commit KB | type: recurring | freq: 12h | last: never\n');
	const ok = removeTask(dir, 'Commit KB');
	assert.equal(ok, true);
	const raw = readTasks(dir);
	assert(!raw.includes('Commit KB'));
});

test('editTask: renames one-off task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Fix the bug | type: one-off\n');
	const ok = editTask(dir, 'Fix the bug', 'Fix the nasty bug');
	assert.equal(ok, true);
	const raw = readTasks(dir);
	assert(!raw.includes('Fix the bug'));
	assert(raw.includes('Fix the nasty bug'));
});

test('editTask: returns false for nonexistent task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Something | type: one-off\n');
	const ok = editTask(dir, 'Does not exist', 'New name');
	assert.equal(ok, false);
});

test('editTask: renames recurring tasks', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Commit KB | type: recurring | freq: 12h | last: never\n');
	const ok = editTask(dir, 'Commit KB', 'New name');
	assert.equal(ok, true);
	const raw = readTasks(dir);
	assert(raw.includes('New name'));
	assert(!raw.includes('Commit KB'));
});

test('completeTask: updates last: timestamp on recurring task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Commit KB | type: recurring | freq: 12h | last: never\n');
	const ok = completeTask(dir, 'Commit KB');
	assert.equal(ok, true);
	const raw = readTasks(dir);
	assert(!raw.includes('last: never'));
	// Should contain a recent timestamp
	const today = new Date().toISOString().slice(0, 10);
	assert(raw.includes(today));
});

test('completeTask: returns false for one-off tasks', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Fix the bug | type: one-off\n');
	const ok = completeTask(dir, 'Fix the bug');
	assert.equal(ok, false);
});

test('completeTask: returns false for nonexistent task', () => {
	const dir = makeTempDir();
	writeTasks(dir, '- [ ] Something | type: recurring | freq: daily | last: never\n');
	const ok = completeTask(dir, 'Nonexistent');
	assert.equal(ok, false);
});

test('loadTasks: missing file returns empty list gracefully', () => {
	const dir = makeTempDir();
	// No tasks.md file
	const { tasks } = loadTasks(dir);
	assert.equal(tasks.length, 0);
});

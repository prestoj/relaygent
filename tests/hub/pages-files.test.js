/**
 * Tests for the files page server loader.
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/pages-files.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-page-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

const sharedDir = path.join(tmpDir, 'shared');
fs.mkdirSync(sharedDir, { recursive: true });

const { load } = await import('../../hub/src/routes/files/+page.server.js');

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test('files load returns files array', () => {
	const data = load();
	assert.ok(Array.isArray(data.files));
});

test('files load returns empty when no files', () => {
	const data = load();
	assert.equal(data.files.length, 0);
});

test('files load includes uploaded file', () => {
	fs.writeFileSync(path.join(sharedDir, 'test.txt'), 'hello');
	const data = load();
	const found = data.files.find(f => f.name === 'test.txt');
	assert.ok(found);
	assert.equal(found.size, 5);
	assert.ok(found.modified);
});

test('files load excludes hidden files', () => {
	fs.writeFileSync(path.join(sharedDir, '.hidden'), 'secret');
	const data = load();
	assert.ok(!data.files.some(f => f.name === '.hidden'));
});

test('files load excludes directories', () => {
	fs.mkdirSync(path.join(sharedDir, 'subdir'), { recursive: true });
	const data = load();
	assert.ok(!data.files.some(f => f.name === 'subdir'));
});

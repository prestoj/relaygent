import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;
let files;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-test-'));
	process.env.RELAYGENT_DATA_DIR = tmpDir;
	// Dynamic import to pick up env
	const mod = await import('../../hub/src/lib/files.js?t=' + Date.now());
	files = mod;
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('files.js', () => {
	it('getSharedDir creates shared directory', () => {
		const dir = files.getSharedDir();
		assert.ok(fs.existsSync(dir));
		assert.ok(dir.endsWith('shared'));
	});

	it('listFiles returns empty on fresh dir', () => {
		const list = files.listFiles();
		assert.deepEqual(list, []);
	});

	it('listFiles returns files sorted by modified desc', () => {
		const dir = files.getSharedDir();
		const older = new Date('2025-01-01T00:00:00Z');
		const newer = new Date('2025-06-01T00:00:00Z');
		fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
		fs.utimesSync(path.join(dir, 'a.txt'), older, older);
		fs.writeFileSync(path.join(dir, 'b.txt'), 'world');
		fs.utimesSync(path.join(dir, 'b.txt'), newer, newer);
		const list = files.listFiles();
		assert.equal(list.length, 2);
		assert.equal(list[0].name, 'b.txt');
		assert.equal(list[1].name, 'a.txt');
	});

	it('listFiles excludes hidden files', () => {
		const dir = files.getSharedDir();
		fs.writeFileSync(path.join(dir, '.hidden'), 'secret');
		fs.writeFileSync(path.join(dir, 'visible.txt'), 'ok');
		const list = files.listFiles();
		assert.equal(list.length, 1);
		assert.equal(list[0].name, 'visible.txt');
	});

	it('listFiles excludes directories', () => {
		const dir = files.getSharedDir();
		fs.mkdirSync(path.join(dir, 'subdir'));
		fs.writeFileSync(path.join(dir, 'file.txt'), 'ok');
		const list = files.listFiles();
		assert.equal(list.length, 1);
		assert.equal(list[0].name, 'file.txt');
	});

	it('validateFilename rejects empty', () => {
		assert.ok(files.validateFilename(''));
		assert.ok(files.validateFilename(null));
	});

	it('validateFilename rejects path traversal', () => {
		assert.ok(files.validateFilename('../etc/passwd'));
		assert.ok(files.validateFilename('foo/bar'));
	});

	it('validateFilename rejects hidden files', () => {
		assert.ok(files.validateFilename('.env'));
	});

	it('validateFilename accepts valid names', () => {
		assert.equal(files.validateFilename('readme.txt'), null);
		assert.equal(files.validateFilename('my-file_2.pdf'), null);
	});

	it('getFilePath returns error for invalid name', () => {
		const result = files.getFilePath('../hack');
		assert.ok(result.error);
	});

	it('getFilePath returns path for valid name', () => {
		const result = files.getFilePath('test.txt');
		assert.ok(result.path);
		assert.ok(result.path.endsWith('test.txt'));
	});
});

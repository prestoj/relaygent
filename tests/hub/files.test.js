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
		assert.deepEqual(files.listFiles(), []);
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

	it('listFiles includes folders, sorted before files, with a relative path', () => {
		const dir = files.getSharedDir();
		fs.mkdirSync(path.join(dir, 'subdir'));
		fs.writeFileSync(path.join(dir, 'file.txt'), 'ok');
		const list = files.listFiles();
		assert.equal(list.length, 2);
		assert.equal(list[0].name, 'subdir');
		assert.equal(list[0].isDir, true);
		assert.equal(list[0].path, 'subdir');
		assert.equal(list[1].name, 'file.txt');
		assert.equal(list[1].isDir, false);
	});

	it('listFiles lists a subdirectory and reports nested paths', () => {
		const dir = files.getSharedDir();
		fs.mkdirSync(path.join(dir, 'docs'));
		fs.writeFileSync(path.join(dir, 'docs', 'note.md'), '# hi');
		const list = files.listFiles('docs');
		assert.equal(list.length, 1);
		assert.equal(list[0].name, 'note.md');
		assert.equal(list[0].path, path.join('docs', 'note.md'));
	});

	it('listFiles returns empty for a traversal subdir', () => {
		assert.deepEqual(files.listFiles('../..'), []);
	});

	it('validateFilename rejects empty / traversal / hidden, accepts valid', () => {
		assert.ok(files.validateFilename(''));
		assert.ok(files.validateFilename(null));
		assert.ok(files.validateFilename('../etc/passwd'));
		assert.ok(files.validateFilename('foo/bar'));
		assert.ok(files.validateFilename('.env'));
		assert.equal(files.validateFilename('readme.txt'), null);
		assert.equal(files.validateFilename('my-file_2.pdf'), null);
	});

	it('validatePath accepts nested paths, rejects traversal/absolute/hidden', () => {
		assert.equal(files.validatePath('a/b/c.txt'), null);
		assert.equal(files.validatePath('file.txt'), null);
		assert.ok(files.validatePath('../escape'));
		assert.ok(files.validatePath('a/../../etc'));
		assert.ok(files.validatePath('/abs/path'));
		assert.ok(files.validatePath('a/.hidden/b'));
		assert.ok(files.validatePath(''));
	});

	it('safeResolve contains paths within the share root', () => {
		const root = files.getSharedDir();
		assert.equal(files.safeResolve('a/b.txt').path, path.join(root, 'a/b.txt'));
		assert.equal(files.safeResolve('').path, root);
		assert.ok(files.safeResolve('../../etc/passwd').error);
		assert.ok(files.safeResolve('a/../../..').error);
	});

	it('safeResolve rejects a symlink that escapes the share (realpath guard)', () => {
		const root = files.getSharedDir();
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'files-outside-'));
		try {
			// A symlinked dir inside the share pointing outside it passes the lexical
			// check but must be rejected once the real path is resolved.
			fs.symlinkSync(outside, path.join(root, 'escape'));
			assert.ok(files.safeResolve('escape').error, 'symlinked dir should be rejected');
			assert.ok(files.safeResolve('escape/secret.txt').error, 'path through symlink rejected');
			// A symlink to a sibling still inside the share stays allowed.
			fs.mkdirSync(path.join(root, 'real'));
			fs.symlinkSync(path.join(root, 'real'), path.join(root, 'inside'));
			assert.ok(files.safeResolve('inside').path, 'in-share symlink allowed');
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});

	it('getFilePath rejects traversal/hidden, resolves valid (existence left to caller)', () => {
		assert.ok(files.getFilePath('../hack').error);
		assert.ok(files.getFilePath('.env').error);
		// A non-existent but well-formed path still resolves — routes turn ENOENT into 404.
		assert.ok(files.getFilePath('nope.txt').path);
	});

	it('getFilePath returns path for an existing nested file', () => {
		const dir = files.getSharedDir();
		fs.mkdirSync(path.join(dir, 'sub'));
		fs.writeFileSync(path.join(dir, 'sub', 'test.txt'), 'x');
		const result = files.getFilePath('sub/test.txt');
		assert.ok(result.path);
		assert.ok(result.path.endsWith(path.join('sub', 'test.txt')));
	});

	it('createDir makes nested folders and rejects traversal', () => {
		assert.deepEqual(files.createDir('a/b/c'), { ok: true });
		assert.ok(fs.existsSync(path.join(files.getSharedDir(), 'a/b/c')));
		assert.ok(files.createDir('../evil').error);
	});

	it('renameEntry renames and moves, guarding overwrite & traversal', () => {
		const dir = files.getSharedDir();
		fs.writeFileSync(path.join(dir, 'old.txt'), 'data');
		assert.deepEqual(files.renameEntry('old.txt', 'new.txt'), { ok: true });
		assert.ok(fs.existsSync(path.join(dir, 'new.txt')));
		// move into a (new) folder
		assert.deepEqual(files.renameEntry('new.txt', 'folder/moved.txt'), { ok: true });
		assert.ok(fs.existsSync(path.join(dir, 'folder', 'moved.txt')));
		// missing source
		assert.ok(files.renameEntry('ghost.txt', 'x.txt').error);
		// overwrite guard
		fs.writeFileSync(path.join(dir, 'keep.txt'), '1');
		assert.ok(files.renameEntry('folder/moved.txt', 'keep.txt').error);
		// traversal
		assert.ok(files.renameEntry('keep.txt', '../out.txt').error);
	});

	it('deleteEntry removes files, empty dirs, and recursive dirs', () => {
		const dir = files.getSharedDir();
		fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
		assert.deepEqual(files.deleteEntry('f.txt'), { ok: true });
		assert.ok(!fs.existsSync(path.join(dir, 'f.txt')));

		fs.mkdirSync(path.join(dir, 'empty'));
		assert.deepEqual(files.deleteEntry('empty'), { ok: true });

		fs.mkdirSync(path.join(dir, 'full'));
		fs.writeFileSync(path.join(dir, 'full', 'inner.txt'), 'x');
		assert.equal(files.deleteEntry('full').error, 'Folder not empty');
		assert.deepEqual(files.deleteEntry('full', { recursive: true }), { ok: true });
		assert.ok(!fs.existsSync(path.join(dir, 'full')));

		assert.equal(files.deleteEntry('ghost').error, 'File not found');
		assert.ok(files.deleteEntry('../etc').error);
	});
});

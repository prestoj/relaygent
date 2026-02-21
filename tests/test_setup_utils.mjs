/**
 * Tests for setup-utils.mjs — port check, CLI symlink, completion display.
 * Run: node --test test_setup_utils.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'net';

const TEST_DIR = join(tmpdir(), `relaygent-setup-utils-test-${process.pid}`);
const FAKE_HOME = join(TEST_DIR, 'home');
const FAKE_REPO = join(TEST_DIR, 'repo');

before(() => {
	mkdirSync(join(FAKE_HOME), { recursive: true });
	mkdirSync(join(FAKE_REPO, 'bin'), { recursive: true });
	writeFileSync(join(FAKE_REPO, 'bin', 'relaygent'), '#!/bin/sh\necho ok');
});

after(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const { checkPortConflict, printSetupComplete, setupCliSymlink } =
	await import('../../setup-utils.mjs');

const C = { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', red: '' };

describe('checkPortConflict', () => {
	it('does not exit when port is free', async () => {
		// Use a high random port unlikely to be in use
		await checkPortConflict(0, C); // port 0 = OS picks a free port
	});

	it('detects port conflict', async () => {
		// Bind a port, then check for conflict
		const server = createServer();
		const port = await new Promise(resolve => {
			server.listen(0, '127.0.0.1', () => resolve(server.address().port));
		});
		// Mock process.exit to catch the call
		const origExit = process.exit;
		let exitCalled = false;
		process.exit = () => { exitCalled = true; throw new Error('exit'); };
		try {
			await checkPortConflict(port, C);
		} catch (e) {
			assert.ok(e.message === 'exit');
		} finally {
			process.exit = origExit;
			server.close();
		}
		assert.ok(exitCalled, 'should have called process.exit');
	});
});

describe('printSetupComplete', () => {
	it('does not throw', () => {
		assert.doesNotThrow(() => printSetupComplete(8080, C));
	});
});

describe('setupCliSymlink', () => {
	it('creates symlink in ~/bin', () => {
		setupCliSymlink(FAKE_REPO, FAKE_HOME, C);
		const link = join(FAKE_HOME, 'bin', 'relaygent');
		assert.ok(existsSync(link), 'symlink should exist');
	});

	it('is idempotent', () => {
		setupCliSymlink(FAKE_REPO, FAKE_HOME, C);
		setupCliSymlink(FAKE_REPO, FAKE_HOME, C);
		assert.ok(existsSync(join(FAKE_HOME, 'bin', 'relaygent')));
	});
});

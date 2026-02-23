/**
 * Tests for setup-remote.mjs — remote access setup (TLS + password).
 * Run: node --test test_setup_remote.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `relaygent-setup-remote-test-${process.pid}`);
const FAKE_HOME = join(TEST_DIR, 'home');
const FAKE_REPO = join(TEST_DIR, 'repo');

before(() => {
	mkdirSync(join(FAKE_HOME, '.relaygent'), { recursive: true });
	mkdirSync(join(FAKE_REPO, 'hub', 'src', 'lib'), { recursive: true });
	// Create a minimal auth.js with hashPassword
	writeFileSync(join(FAKE_REPO, 'hub', 'src', 'lib', 'auth.js'),
		`import crypto from 'crypto';\nexport function hashPassword(p) { return 'hash:' + p; }\n`);
});

after(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const C = { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', red: '' };

const { setupRemote } = await import('../../setup/setup-remote.mjs');
const { printSetupComplete } = await import('../../setup/setup-utils.mjs');

describe('setupRemote', () => {
	it('skips when user answers n', async () => {
		const config = { hub: { port: 8080 } };
		const ask = () => Promise.resolve('n');
		await setupRemote(config, FAKE_REPO, C, ask);
		assert.equal(config.hub.tls, undefined, 'should not set TLS');
		assert.equal(config.hub.passwordHash, undefined, 'should not set password');
	});

	it('sets password when user provides matching passwords', async () => {
		const config = { hub: { port: 8080 } };
		const answers = ['n', 'y', 'test1234', 'test1234']; // skip TLS via no tailscale, yes password
		let i = 0;
		// First 'n' won't be reached since we go through TLS first
		// Flow: remote? y → (no tailscale) → password? y → pw → confirm
		const responses = ['y', 'y', 'mypass1', 'mypass1'];
		const ask = () => Promise.resolve(responses[i++] || '');
		await setupRemote(config, FAKE_REPO, C, ask);
		assert.ok(config.hub.passwordHash, 'should have password hash');
		assert.ok(config.hub.passwordHash.includes('hash:mypass1'), 'hash should contain password');
	});

	it('skips password on mismatch', async () => {
		const config = { hub: { port: 8080 } };
		const responses = ['y', 'y', 'pass1', 'pass2']; // remote yes, pw yes, mismatch
		let i = 0;
		const ask = () => Promise.resolve(responses[i++] || '');
		await setupRemote(config, FAKE_REPO, C, ask);
		assert.equal(config.hub.passwordHash, undefined, 'should not set password on mismatch');
	});

	it('skips password when too short', async () => {
		const config = { hub: { port: 8080 } };
		const responses = ['y', 'y', 'ab', '']; // remote yes, pw yes, too short
		let i = 0;
		const ask = () => Promise.resolve(responses[i++] || '');
		await setupRemote(config, FAKE_REPO, C, ask);
		assert.equal(config.hub.passwordHash, undefined, 'should not set short password');
	});
});

describe('printSetupComplete with remote config', () => {
	it('shows remote URL when TLS is configured', () => {
		const config = { hub: { port: 8080, tls: { hostname: 'agent.ts.net', cert: '/c', key: '/k' } } };
		// Capture console output
		const logs = [];
		const origLog = console.log;
		console.log = (msg) => logs.push(msg);
		printSetupComplete(8080, C, config);
		console.log = origLog;
		const hasRemote = logs.some(l => l.includes('agent.ts.net'));
		assert.ok(hasRemote, 'should show remote URL with hostname');
	});

	it('uses https in dashboard URL when TLS configured', () => {
		const config = { hub: { port: 8080, tls: { hostname: 'agent.ts.net', cert: '/c', key: '/k' } } };
		const logs = [];
		const origLog = console.log;
		console.log = (msg) => logs.push(msg);
		printSetupComplete(8080, C, config);
		console.log = origLog;
		const hasTls = logs.some(l => l.includes('https://localhost'));
		assert.ok(hasTls, 'dashboard URL should use https');
	});

	it('does not show remote URL without TLS', () => {
		const logs = [];
		const origLog = console.log;
		console.log = (msg) => logs.push(msg);
		printSetupComplete(8080, C, {});
		console.log = origLog;
		const hasRemote = logs.some(l => l.includes('Remote'));
		assert.ok(!hasRemote, 'should not show remote URL without TLS');
	});
});

/**
 * Tests for hub authentication (auth.js).
 * Tests password hashing, session tokens, and config integration.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/auth.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Temp home for isolation
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
const configDir = path.join(tmpHome, '.relaygent');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ hub: { port: 8080 } }));
process.env.HOME = tmpHome;

const { hashPassword, verifyPassword, checkPassword, createSession, validateSession,
	isAuthEnabled, setPasswordInConfig, COOKIE_NAME } = await import('../../hub/src/lib/auth.js');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

// --- password hashing ---

test('hashPassword returns salt:hash format', () => {
	const h = hashPassword('test123');
	assert.ok(h.includes(':'), 'should contain colon separator');
	const [salt, hash] = h.split(':');
	assert.equal(salt.length, 32, 'salt should be 32 hex chars');
	assert.equal(hash.length, 128, 'hash should be 128 hex chars');
});

test('hashPassword produces unique hashes', () => {
	const h1 = hashPassword('same');
	const h2 = hashPassword('same');
	assert.notEqual(h1, h2, 'different salts should produce different hashes');
});

test('verifyPassword returns true for correct password', () => {
	const h = hashPassword('mypassword');
	assert.ok(verifyPassword('mypassword', h));
});

test('verifyPassword returns false for wrong password', () => {
	const h = hashPassword('mypassword');
	assert.ok(!verifyPassword('wrongpassword', h));
});

test('verifyPassword returns false for malformed hash', () => {
	assert.ok(!verifyPassword('test', 'nocolon'));
	assert.ok(!verifyPassword('test', ''));
});

// --- auth enabled ---

test('isAuthEnabled returns false without passwordHash', () => {
	assert.ok(!isAuthEnabled());
});

test('isAuthEnabled returns true after setPasswordInConfig', () => {
	setPasswordInConfig('hubpass');
	assert.ok(isAuthEnabled());
});

test('checkPassword returns true for correct password', () => {
	assert.ok(checkPassword('hubpass'));
});

test('checkPassword returns false for wrong password', () => {
	assert.ok(!checkPassword('wrong'));
});

// --- session tokens ---

test('createSession returns a token with payload.sig format', () => {
	const token = createSession();
	assert.ok(token.includes('.'), 'should contain dot separator');
	const parts = token.split('.');
	assert.equal(parts.length, 2, 'should have exactly 2 parts');
});

test('validateSession returns true for fresh token', () => {
	const token = createSession();
	assert.ok(validateSession(token));
});

test('validateSession returns false for tampered token', () => {
	const token = createSession();
	const tampered = token.slice(0, -4) + 'xxxx';
	assert.ok(!validateSession(tampered));
});

test('validateSession returns false for empty/null', () => {
	assert.ok(!validateSession(null));
	assert.ok(!validateSession(''));
	assert.ok(!validateSession(undefined));
});

test('validateSession returns false for garbage', () => {
	assert.ok(!validateSession('not.a.valid.token'));
	assert.ok(!validateSession('abc.def'));
});

test('COOKIE_NAME is relaygent_session', () => {
	assert.equal(COOKIE_NAME, 'relaygent_session');
});

// --- cleanup: remove password so other tests aren't affected ---
test('setPasswordInConfig writes to config.json', () => {
	const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8'));
	assert.ok(cfg.hub.passwordHash, 'passwordHash should exist');
	assert.ok(cfg.hub.sessionSecret, 'sessionSecret should be auto-created');
});

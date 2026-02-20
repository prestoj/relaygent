/**
 * Tests for hub/src/lib/chatCrypto.js
 * Uses Node.js built-in test runner.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let encrypt, decrypt, decryptOrPassthrough;

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatcrypto-test-'));
	process.env.RELAYGENT_DATA_DIR = tmpDir;
	({ encrypt, decrypt, decryptOrPassthrough } = await import('../src/lib/chatCrypto.js'));
});

after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('encrypt: returns hex string', () => {
	const result = encrypt('hello world');
	assert.ok(typeof result === 'string');
	assert.ok(/^[0-9a-f]+$/.test(result), `should be hex: ${result.slice(0, 20)}...`);
});

test('encrypt: output is longer than input (has IV + tag overhead)', () => {
	const plain = 'test message';
	const enc = encrypt(plain);
	// AES-GCM: 12 IV + 16 tag + ciphertext, all hex = *2
	assert.ok(enc.length > plain.length * 2, `enc.length ${enc.length} > plain.length*2 ${plain.length * 2}`);
});

test('encrypt: two encryptions of same plaintext produce different ciphertext', () => {
	const plain = 'same message';
	const enc1 = encrypt(plain);
	const enc2 = encrypt(plain);
	assert.notEqual(enc1, enc2, 'each encryption should use a random IV');
});

test('decrypt: round-trips plaintext correctly', () => {
	const plain = 'hello, world!';
	const enc = encrypt(plain);
	const dec = decrypt(enc);
	assert.equal(dec, plain);
});

test('decrypt: handles unicode plaintext', () => {
	const plain = 'こんにちは 🌍 résumé';
	const enc = encrypt(plain);
	const dec = decrypt(enc);
	assert.equal(dec, plain);
});

test('decrypt: returns null for empty string (ciphertext too short)', () => {
	// encrypt('') produces 56 hex chars (IV+tag only, no ciphertext bytes)
	// decrypt requires at least IV(12)+TAG(16)+1 = 29 bytes = 58 hex chars
	const enc = encrypt('');
	assert.equal(enc.length, 56, `expected 56 hex chars, got ${enc.length}`);
	const dec = decrypt(enc);
	assert.equal(dec, null);
});

test('decrypt: handles long plaintext', () => {
	const plain = 'x'.repeat(10000);
	const enc = encrypt(plain);
	const dec = decrypt(enc);
	assert.equal(dec, plain);
});

test('decrypt: returns null for invalid hex', () => {
	const result = decrypt('not-hex-at-all');
	assert.equal(result, null);
});

test('decrypt: returns null for too-short buffer', () => {
	// Need at least IV(12) + TAG(16) + 1 byte = 29 bytes = 58 hex chars
	const result = decrypt('deadbeef');
	assert.equal(result, null);
});

test('decrypt: returns null for tampered ciphertext', () => {
	const enc = encrypt('secret message');
	// Flip a character in the middle (ciphertext area, past IV+tag)
	const tampered = enc.slice(0, 60) + (enc[60] === 'a' ? 'b' : 'a') + enc.slice(61);
	const result = decrypt(tampered);
	assert.equal(result, null);
});

test('decrypt: returns null for tampered auth tag', () => {
	const enc = encrypt('secret');
	// Tamper with auth tag area (bytes 12-27 = hex chars 24-54)
	const arr = enc.split('');
	arr[30] = arr[30] === 'a' ? 'b' : 'a';
	const result = decrypt(arr.join(''));
	assert.equal(result, null);
});

// --- decryptOrPassthrough ---

test('decryptOrPassthrough: decrypts valid encrypted value', () => {
	const plain = 'important message';
	const enc = encrypt(plain);
	const result = decryptOrPassthrough(enc);
	assert.equal(result, plain);
});

test('decryptOrPassthrough: returns plaintext as-is if not hex', () => {
	const plain = 'just a plain string';
	const result = decryptOrPassthrough(plain);
	assert.equal(result, plain);
});

test('decryptOrPassthrough: returns short hex string as-is (too short to be encrypted)', () => {
	// A valid hex string but too short to be AES-GCM (< 58 hex chars)
	const shortHex = 'deadbeef1234';
	const result = decryptOrPassthrough(shortHex);
	assert.equal(result, shortHex);
});

test('decryptOrPassthrough: returns null/undefined unchanged', () => {
	assert.equal(decryptOrPassthrough(null), null);
	assert.equal(decryptOrPassthrough(undefined), undefined);
});

test('decryptOrPassthrough: uses same key across calls (consistent decryption)', () => {
	const plain = 'persistent message';
	const enc = encrypt(plain);
	// Call multiple times — same key should be used
	assert.equal(decryptOrPassthrough(enc), plain);
	assert.equal(decryptOrPassthrough(enc), plain);
	assert.equal(decryptOrPassthrough(enc), plain);
});

/**
 * Tests for the secrets vault module ($lib/secrets.js) and the
 * /api/secrets route handlers (GET list / POST add / DELETE).
 *
 * HOME is pointed at a tmp dir BEFORE import so the module's load-time paths
 * (~/.relaygent/secrets.json + master.key) never touch the real vault.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/api-secrets.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-home-'));
process.env.HOME = tmpHome;

const secrets = await import('../../hub/src/lib/secrets.js');
const { GET, POST, DELETE: DEL } = await import('../../hub/src/routes/api/secrets/+server.js');

const secretsFile = path.join(tmpHome, '.relaygent', 'secrets.json');

function postReq(body) {
	return { request: { json: async () => body } };
}
function delUrl(name) {
	const u = new URL('http://localhost/api/secrets');
	if (name !== undefined) u.searchParams.set('name', name);
	return { url: u };
}

// --- module: validation ---

test('isValidName accepts sane names, rejects junk', () => {
	assert.ok(secrets.isValidName('STRIPE_KEY'));
	assert.ok(secrets.isValidName('my-secret-1'));
	assert.ok(!secrets.isValidName(''));
	assert.ok(!secrets.isValidName('has space'));
	assert.ok(!secrets.isValidName('../etc/passwd'));
	assert.ok(!secrets.isValidName('a'.repeat(129)));
});

// --- module: roundtrip + encryption at rest ---

test('setSecret then listSecretNames returns the name (not the value)', () => {
	assert.equal(secrets.setSecret('API_KEY', 'sk-abc123'), true);
	const names = secrets.listSecretNames();
	assert.ok(names.includes('API_KEY'));
	assert.ok(!names.includes('sk-abc123'));
});

test('value is encrypted at rest (plaintext not in file)', () => {
	secrets.setSecret('TOKEN', 'plaintext-supersecret');
	const raw = fs.readFileSync(secretsFile, 'utf-8');
	assert.ok(!raw.includes('plaintext-supersecret'), 'plaintext must not appear on disk');
});

test('setSecret rejects empty value and bad name', () => {
	assert.equal(secrets.setSecret('GOOD', ''), false);
	assert.equal(secrets.setSecret('bad name', 'v'), false);
});

test('deleteSecret removes it; returns false when absent', () => {
	secrets.setSecret('TMP', 'x');
	assert.equal(secrets.deleteSecret('TMP'), true);
	assert.ok(!secrets.listSecretNames().includes('TMP'));
	assert.equal(secrets.deleteSecret('TMP'), false);
});

// --- route: GET ---

test('GET returns names array', async () => {
	secrets.setSecret('LISTED', 'v');
	const res = GET();
	const data = await res.json();
	assert.ok(Array.isArray(data.names));
	assert.ok(data.names.includes('LISTED'));
});

// --- route: POST ---

test('POST stores a secret (201) and never echoes the value', async () => {
	const res = await POST(postReq({ name: 'POSTED', value: 'hunter2' }));
	assert.equal(res.status, 201);
	const data = await res.json();
	assert.equal(data.name, 'POSTED');
	assert.equal(data.value, undefined);
	assert.ok(secrets.listSecretNames().includes('POSTED'));
});

test('POST rejects invalid name (400)', async () => {
	const res = await POST(postReq({ name: 'bad name', value: 'v' }));
	assert.equal(res.status, 400);
});

test('POST rejects empty value (400)', async () => {
	const res = await POST(postReq({ name: 'NOVAL', value: '' }));
	assert.equal(res.status, 400);
});

// --- route: DELETE ---

test('DELETE removes an existing secret', async () => {
	secrets.setSecret('TODEL', 'v');
	const res = DEL(delUrl('TODEL'));
	assert.equal((await res.json()).ok, true);
	assert.ok(!secrets.listSecretNames().includes('TODEL'));
});

test('DELETE returns 404 for missing, 400 for invalid name', async () => {
	assert.equal(DEL(delUrl('NOPE')).status, 404);
	assert.equal(DEL(delUrl('bad name')).status, 400);
});

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

/**
 * Hub-side reader/writer for the relaygent secrets vault.
 *
 * Mirrors the on-disk format of `secrets/vault.mjs` (the source of truth used
 * by the secrets MCP + CLI): AES-256-GCM, master key at ~/.relaygent/master.key
 * (chmod 600), encrypted values in ~/.relaygent/secrets.json. We re-implement
 * the format here rather than import across packages so the hub stays
 * self-contained; the on-disk format is the stable contract both sides share.
 *
 * The hub never returns secret VALUES to the client — only names (list) and
 * write/delete. So getSecret is intentionally not exported.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DIR = join(homedir(), '.relaygent');
const SECRETS_PATH = join(DIR, 'secrets.json');
const KEY_PATH = join(DIR, 'master.key');
const ALG = 'aes-256-gcm';

// A valid secret name: lowercase/uppercase letters, digits, underscore, dash.
const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
export function isValidName(name) {
	return typeof name === 'string' && NAME_RE.test(name);
}

function getMasterKey() {
	if (existsSync(KEY_PATH)) {
		return Buffer.from(readFileSync(KEY_PATH, 'utf-8').trim(), 'hex');
	}
	mkdirSync(DIR, { recursive: true });
	const key = randomBytes(32).toString('hex');
	writeFileSync(KEY_PATH, key, { mode: 0o600 });
	chmodSync(KEY_PATH, 0o600);
	return Buffer.from(key, 'hex');
}

function encryptValue(plaintext) {
	const key = getMasterKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALG, key, iv);
	const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString('hex');
}

function isEncrypted(val) {
	return typeof val === 'string' && /^[0-9a-f]{58,}$/i.test(val);
}

function decryptValue(hex) {
	try {
		const key = getMasterKey();
		const buf = Buffer.from(hex, 'hex');
		if (buf.length < 29) return hex;
		const iv = buf.subarray(0, 12);
		const tag = buf.subarray(12, 28);
		const enc = buf.subarray(28);
		const decipher = createDecipheriv(ALG, key, iv);
		decipher.setAuthTag(tag);
		return decipher.update(enc, undefined, 'utf8') + decipher.final('utf8');
	} catch {
		return hex;
	}
}

function load() {
	if (!existsSync(SECRETS_PATH)) return {};
	try {
		const raw = JSON.parse(readFileSync(SECRETS_PATH, 'utf-8'));
		return Object.fromEntries(
			Object.entries(raw).map(([k, v]) => [k, isEncrypted(v) ? decryptValue(v) : v]),
		);
	} catch {
		return {};
	}
}

function save(secrets) {
	mkdirSync(DIR, { recursive: true });
	const encrypted = Object.fromEntries(
		Object.entries(secrets).map(([k, v]) => [k, encryptValue(String(v))]),
	);
	const tmp = SECRETS_PATH + '.tmp';
	writeFileSync(tmp, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
	renameSync(tmp, SECRETS_PATH);
	chmodSync(SECRETS_PATH, 0o600);
}

/** List secret names only (never values). */
export function listSecretNames() {
	return Object.keys(load()).sort();
}

/** Add or overwrite a secret. Returns true on success. */
export function setSecret(name, value) {
	if (!isValidName(name) || typeof value !== 'string' || value === '') return false;
	const s = load();
	s[name] = value;
	save(s);
	return true;
}

/** Delete a secret. Returns true if it existed. */
export function deleteSecret(name) {
	const s = load();
	if (!(name in s)) return false;
	delete s[name];
	save(s);
	return true;
}

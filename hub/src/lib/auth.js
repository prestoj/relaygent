/**
 * Hub authentication — password hashing (scrypt) and session cookies (HMAC).
 * No external dependencies; uses Node's built-in crypto module.
 * Password hash stored in ~/.relaygent/config.json as hub.passwordHash.
 * When hub.passwordHash is absent, auth is disabled (open access).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.env.HOME, '.relaygent', 'config.json');
const COOKIE_NAME = 'relaygent_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

function readConfig() {
	try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; }
}

function getSecret() {
	const cfg = readConfig();
	if (cfg.hub?.sessionSecret) return cfg.hub.sessionSecret;
	const secret = crypto.randomBytes(32).toString('hex');
	if (!cfg.hub) cfg.hub = {};
	cfg.hub.sessionSecret = secret;
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
	return secret;
}

let _secret = null;
function secret() { if (!_secret) _secret = getSecret(); return _secret; }

export function isAuthEnabled() {
	const cfg = readConfig();
	return !!cfg.hub?.passwordHash;
}

export function hashPassword(password) {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = crypto.scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const derived = crypto.scryptSync(password, salt, 64).toString('hex');
	return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

export function checkPassword(password) {
	const cfg = readConfig();
	if (!cfg.hub?.passwordHash) return false;
	return verifyPassword(password, cfg.hub.passwordHash);
}

export function createSession() {
	const payload = JSON.stringify({ t: Date.now(), r: crypto.randomBytes(8).toString('hex') });
	const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
	return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function validateSession(token) {
	if (!token) return false;
	const [payloadB64, sig] = token.split('.');
	if (!payloadB64 || !sig) return false;
	try {
		const payload = Buffer.from(payloadB64, 'base64url').toString();
		const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
		if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false;
		const { t } = JSON.parse(payload);
		return (Date.now() - t) < SESSION_MAX_AGE * 1000;
	} catch { return false; }
}

export function setPasswordInConfig(password) {
	const cfg = readConfig();
	if (!cfg.hub) cfg.hub = {};
	cfg.hub.passwordHash = hashPassword(password);
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export { COOKIE_NAME, SESSION_MAX_AGE };

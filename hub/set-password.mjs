#!/usr/bin/env node
/**
 * Set or remove the hub dashboard password.
 * Usage: node hub/set-password.mjs           (interactive prompt)
 *        node hub/set-password.mjs --remove   (disable auth)
 */
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.env.HOME, '.relaygent', 'config.json');

function readConfig() {
	try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; }
}

if (process.argv.includes('--remove')) {
	const cfg = readConfig();
	if (cfg.hub) { delete cfg.hub.passwordHash; delete cfg.hub.sessionSecret; }
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
	console.log('Hub authentication disabled. Restart the hub to apply.');
	process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const pw = await ask('New hub password: ');
if (!pw || pw.length < 4) {
	console.log('Password must be at least 4 characters.'); rl.close(); process.exit(1);
}
const pw2 = await ask('Confirm password: ');
if (pw !== pw2) {
	console.log('Passwords do not match.'); rl.close(); process.exit(1);
}

// Import auth module for hashing
const { hashPassword } = await import('./src/lib/auth.js');
const cfg = readConfig();
if (!cfg.hub) cfg.hub = {};
cfg.hub.passwordHash = hashPassword(pw);
delete cfg.hub.sessionSecret; // Force new session secret on next start
fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
console.log('Hub password set. Restart the hub to apply.');
rl.close();

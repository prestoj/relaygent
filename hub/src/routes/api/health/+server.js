import { json } from '@sveltejs/kit';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data');
const STATUS_FILE = process.env.RELAY_STATUS_FILE || path.join(DATA_DIR, 'relay-status.json');

function getVersion() {
	try { return execFileSync('git', ['-C', REPO_DIR, 'rev-parse', '--short', 'HEAD'], { timeout: 2000 }).toString().trim(); }
	catch { return null; }
}

function getRelay() {
	try {
		const d = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
		return { status: d.status || 'unknown', session_id: d.session_id || null };
	} catch { return { status: 'off', session_id: null }; }
}

/** GET /api/health — health check with system info for monitoring/CLI */
export function GET() {
	return json({
		status: 'ok',
		version: getVersion(),
		hostname: os.hostname(),
		uptime: Math.round(process.uptime()),
		relay: getRelay(),
	});
}

import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { parseSession, findLatestSession } from '$lib/relayActivity.js';

// Session IDs are UUIDs — reject anything else to prevent path traversal
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findSessionById(sessionId) {
	if (!SESSION_ID_RE.test(sessionId)) return null;
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			const filePath = path.join(fullPath, `${sessionId}.jsonl`);
			if (fs.existsSync(filePath)) return filePath;
		}
	} catch { /* ignore */ }
	return null;
}

const RELAY_PID_FILE = path.join(process.env.HOME, '.relaygent', 'relay.pid');
const RELAY_PY = path.join(process.env.HOME, 'relaygent', 'harness', 'relay.py');
const RELAY_LOG = path.join(process.env.HOME, 'relaygent', 'logs', 'relaygent.log');

function getRelayPid() {
	try {
		const pid = parseInt(fs.readFileSync(RELAY_PID_FILE, 'utf8').trim(), 10);
		return isNaN(pid) ? null : pid;
	} catch { return null; }
}

function isRelayRunning(pid) {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function POST({ request }) {
	let action;
	try { ({ action } = await request.json()); } catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

	if (action === 'stop') {
		const pid = getRelayPid();
		if (!pid || !isRelayRunning(pid)) return json({ ok: true, status: 'already_stopped' });
		try {
			process.kill(pid, 'SIGTERM');
			return json({ ok: true, status: 'stopped' });
		} catch (e) {
			return json({ error: `Failed to stop relay: ${e.message}` }, { status: 500 });
		}
	}

	if (action === 'start') {
		const pid = getRelayPid();
		if (pid && isRelayRunning(pid)) return json({ ok: true, status: 'already_running' });
		try {
			fs.mkdirSync(path.dirname(RELAY_LOG), { recursive: true });
			const logFd = fs.openSync(RELAY_LOG, 'a');
			const child = spawn('python3', [RELAY_PY], {
				detached: true, stdio: ['ignore', logFd, logFd],
			});
			child.unref();
			fs.closeSync(logFd);
			return json({ ok: true, status: 'started' });
		} catch (e) {
			return json({ error: `Failed to start relay: ${e.message}` }, { status: 500 });
		}
	}

	if (action === 'status') {
		const pid = getRelayPid();
		return json({ running: isRelayRunning(pid), pid: pid || null });
	}

	return json({ error: 'Unknown action' }, { status: 400 });
}

export function GET({ url }) {
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
	const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 200));
	const sessionId = url.searchParams.get('session');

	const sessionFile = sessionId ? findSessionById(sessionId) : findLatestSession();
	if (!sessionFile) return json({ activities: [], hasMore: false });

	const activity = parseSession(sessionFile, 500);
	const reversed = activity.reverse();
	const paginated = reversed.slice(offset, offset + limit);

	return json({ activities: paginated, hasMore: offset + limit < reversed.length, total: reversed.length });
}

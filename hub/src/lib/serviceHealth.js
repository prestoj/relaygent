/**
 * Service health checks for the dashboard.
 * Quick HTTP pings with short timeouts — non-blocking.
 * Only checks services that are part of the Relaygent stack.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root is 3 levels up from hub/src/lib/
const REPO_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');

const NOTIFICATIONS_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const HS_PORT = process.env.HAMMERSPOON_PORT || '8097';
const STATUS_FILE = process.env.RELAY_STATUS_FILE
	|| path.join(REPO_DATA_DIR, 'relay-status.json');

const SERVICES = [
	{ name: 'Notifications', url: `http://127.0.0.1:${NOTIFICATIONS_PORT}/health` },
	{ name: 'Computer Use', url: `http://127.0.0.1:${HS_PORT}/health` },
];

async function checkService(svc) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2000);
		const res = await fetch(svc.url, { signal: controller.signal });
		clearTimeout(timeout);
		const ok = res.ok;
		let detail = '';
		if (ok && svc.key) {
			try {
				const data = await res.json();
				detail = data[svc.key] || '';
			} catch { /* ignore */ }
		}
		return { name: svc.name, ok, detail };
	} catch {
		return { name: svc.name, ok: false, detail: '' };
	}
}

function checkRelayStatus() {
	try {
		const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
		const { status, updated, session_id, goal } = data;
		const ok = status === 'working' || status === 'sleeping';
		const labels = { rate_limited: 'rate limited', crashed: 'crashed' };
		let detail = labels[status] || status;
		if (updated) {
			const ageMin = Math.round((Date.now() - new Date(updated).getTime()) / 60000);
			if (ageMin >= 1) detail = `${status} (${ageMin}m)`;
		}
		return { name: 'Relay', ok, detail, sessionId: session_id || null, goal: goal || null };
	} catch {
		return { name: 'Relay', ok: false, detail: 'off', sessionId: null };
	}
}

function checkMcpServers() {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf-8'));
		if (!raw.mcpServers) return null;
		const entries = Object.entries(raw.mcpServers);
		if (entries.length === 0) return null;
		const servers = entries.map(([name, cfg]) => {
			const args = cfg.args || [];
			const mainFile = args[0] || '';
			const exists = mainFile ? fs.existsSync(mainFile) : false;
			return { name, ok: exists };
		});
		const okCount = servers.filter(s => s.ok).length;
		const allOk = okCount === servers.length;
		const detail = servers.map(s => `${s.ok ? '+' : '-'} ${s.name}`).join('\n');
		return { name: `MCP ${okCount}/${servers.length}`, ok: allOk, detail, type: 'mcp', servers };
	} catch { return null; }
}

function checkDisk() {
	try {
		const out = execFileSync('df', ['-h', os.homedir()], { timeout: 2000 }).toString();
		const dataLine = out.trim().split('\n').pop();
		const m = dataLine.match(/(\d+)%/);
		if (!m) return null;
		const used = parseInt(m[1], 10);
		return { name: `Disk ${m[1]}%`, ok: used < 90, detail: '' };
	} catch { return null; }
}

export async function getServiceHealth() {
	const results = await Promise.all(SERVICES.map(checkService));
	const disk = checkDisk();
	const all = [checkRelayStatus(), ...results];
	if (disk) all.push(disk);
	const mcp = checkMcpServers();
	if (mcp) all.push(mcp);
	return all;
}

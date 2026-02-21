import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getServiceHealth } from '$lib/serviceHealth.js';

function fmtBytes(b) {
	if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
	if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
	return `${b} B`;
}

function loadMcpServers() {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf-8'));
		if (!raw.mcpServers) return [];
		return Object.entries(raw.mcpServers).map(([name, cfg]) => ({
			name,
			command: cfg.command || '',
			args: (cfg.args || []).slice(0, 3).join(' '),
		}));
	} catch { return []; }
}

function loadConfig() {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.relaygent', 'config.json'), 'utf-8'));
		return {
			hubPort: raw.hub?.port || 8080,
			notificationsPort: raw.notifications?.port || 8083,
			repoPath: raw.repoPath || '',
			authEnabled: !!raw.hub?.passwordHash,
		};
	} catch { return { hubPort: 8080, notificationsPort: 8083, repoPath: '', authEnabled: false }; }
}

function getSetupChecks(config) {
	const home = os.homedir();
	const kbDir = process.env.RELAYGENT_KB_DIR || path.join(home, 'knowledge', 'topics');
	const checks = [];
	const fileHasContent = (p) => { try { return fs.readFileSync(p, 'utf-8').trim().length > 50; } catch { return false; } };
	const fileExists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
	checks.push({ label: 'Intent', ok: fileHasContent(path.join(kbDir, 'INTENT.md')), hint: 'Edit ~/knowledge/topics/INTENT.md to set agent direction' });
	checks.push({ label: 'CLAUDE.md', ok: fileExists(path.join(home, 'CLAUDE.md')) || fileExists(path.join(process.env.RELAYGENT_REPO || '.', 'CLAUDE.md')), hint: 'Run relaygent setup to generate CLAUDE.md' });
	checks.push({ label: 'Slack', ok: fileExists(path.join(home, '.relaygent', 'slack', 'bot-token')) || fileExists(path.join(home, '.relaygent', 'slack', 'app-token')), hint: 'Run relaygent mcp add slack to configure' });
	checks.push({ label: 'Email', ok: fileExists(path.join(home, '.relaygent', 'gmail', 'credentials.json')), hint: 'Run node email/setup-gmail.mjs to configure' });
	checks.push({ label: 'Auth', ok: config.authEnabled, hint: 'Set hub.passwordHash in ~/.relaygent/config.json' });
	return checks;
}

function getDiskUsage() {
	try {
		const out = execFileSync('df', ['-h', os.homedir()], { timeout: 2000 }).toString();
		const line = out.split('\n')[1];
		if (!line) return null;
		const cols = line.split(/\s+/);
		const pctIdx = cols.findIndex(c => c.endsWith('%'));
		if (pctIdx < 0) return null;
		return { used: cols[pctIdx - 2], total: cols[pctIdx - 3], pct: parseInt(cols[pctIdx]) };
	} catch { return null; }
}

export async function load() {
	const services = await getServiceHealth();
	const upSec = os.uptime();
	const days = Math.floor(upSec / 86400);
	const hrs = Math.floor((upSec % 86400) / 3600);
	const disk = getDiskUsage();
	const system = {
		hostname: os.hostname(),
		platform: `${os.platform()} (${os.arch()})`,
		release: os.release(),
		nodeVersion: process.version,
		uptime: days > 0 ? `${days}d ${hrs}h` : `${hrs}h`,
		cpus: os.cpus().length,
		memUsed: fmtBytes(os.totalmem() - os.freemem()),
		memTotal: fmtBytes(os.totalmem()),
		disk,
	};
	const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
	let version = '';
	try {
		const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, timeout: 2000 }).toString().trim();
		const date = execFileSync('git', ['log', '-1', '--format=%cd', '--date=short'], { cwd: repoRoot, timeout: 2000 }).toString().trim();
		version = `${hash} (${date})`;
	} catch { /* not in git repo */ }
	const config = loadConfig();
	return { system, services, mcpServers: loadMcpServers(), config, version, setupChecks: getSetupChecks(config) };
}

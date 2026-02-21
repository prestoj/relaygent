import os from 'os';
import fs from 'fs';
import path from 'path';
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

export async function load() {
	const services = await getServiceHealth();
	const upSec = os.uptime();
	const days = Math.floor(upSec / 86400);
	const hrs = Math.floor((upSec % 86400) / 3600);
	const system = {
		hostname: os.hostname(),
		platform: `${os.platform()} (${os.arch()})`,
		release: os.release(),
		nodeVersion: process.version,
		uptime: days > 0 ? `${days}d ${hrs}h` : `${hrs}h`,
		cpus: os.cpus().length,
		memUsed: fmtBytes(os.totalmem() - os.freemem()),
		memTotal: fmtBytes(os.totalmem()),
	};
	return { system, services, mcpServers: loadMcpServers(), config: loadConfig() };
}

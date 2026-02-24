import { getRelayActivity } from '$lib/relayActivity.js';
import fs from 'fs';
import path from 'path';
import { getKbDir } from '$lib/kb.js';

const CONFIG_FILE = path.join(process.env.HOME, '.relaygent', 'config.json');
const RELAY_PID_FILE = path.join(process.env.HOME, '.relaygent', 'relay.pid');

function isRelayRunning() {
	try {
		const pid = parseInt(fs.readFileSync(RELAY_PID_FILE, 'utf8').trim(), 10);
		if (isNaN(pid)) return false;
		process.kill(pid, 0);
		return true;
	} catch { return false; }
}

function hasIntentContent() {
	try {
		const raw = fs.readFileSync(path.join(getKbDir(), 'INTENT.md'), 'utf-8');
		if (raw.includes('Delete everything above')) return false;
		const lines = raw.split('\n')
			.filter(l => l.trim() && !l.startsWith('---') && !l.startsWith('tags') && !l.startsWith('title') && !l.startsWith('created') && !l.startsWith('updated') && !l.startsWith('<!--'));
		return lines.length >= 3;
	} catch { return false; }
}

export async function load() {
	const relayActivity = getRelayActivity();
	let isDocker = false;
	try { isDocker = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')).docker === true; } catch {}
	return {
		relayActivity: relayActivity?.recentActivity || [],
		relayRunning: isRelayRunning(),
		hasIntent: hasIntentContent(),
		isDocker,
	};
}

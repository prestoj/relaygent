import { listTopics, getKbDir } from '$lib/kb.js';
import { getRelayActivity } from '$lib/relayActivity.js';
import { getServiceHealth } from '$lib/serviceHealth.js';
import { isConfigured as linearConfigured, listIssues } from '$lib/linear.js';
import fs from 'fs';
import path from 'path';

const RELAY_PID_FILE = path.join(process.env.HOME, '.relaygent', 'relay.pid');

function isRelayRunning() {
	try {
		const pid = parseInt(fs.readFileSync(RELAY_PID_FILE, 'utf8').trim(), 10);
		if (isNaN(pid)) return false;
		process.kill(pid, 0);
		return true;
	} catch { return false; }
}

async function getCurrentTasks() {
	if (!linearConfigured()) return [];
	try {
		const { nodes } = await listIssues({ first: 10 });
		return nodes
			.filter(n => n.state?.name === 'In Progress')
			.map(n => ({ identifier: n.identifier, title: n.title, assignee: n.assignee?.name || null }));
	} catch { return []; }
}

function getAttentionItems() {
	const attentionPath = path.join(getKbDir(), 'attention.md');
	try {
		const raw = fs.readFileSync(attentionPath, 'utf-8');
		const activeMatch = raw.match(/## Active\n([\s\S]*?)(?=\n## |$)/);
		if (activeMatch) {
			return activeMatch[1]
				.split('\n')
				.filter(line => line.startsWith('- '))
				.map(line => line.replace(/^- \*\*([^*]+)\*\*:?\s*/, '<strong>$1:</strong> ').replace(/^- /, ''));
		}
	} catch { /* attention.md doesn't exist */ }
	return [];
}

function hasIntentContent() {
	try {
		const intentPath = path.join(getKbDir(), 'INTENT.md');
		const raw = fs.readFileSync(intentPath, 'utf-8');
		if (raw.includes('Delete everything above')) return false;
		const lines = raw.split('\n')
			.filter(l => l.trim() && !l.startsWith('---') && !l.startsWith('tags') && !l.startsWith('title') && !l.startsWith('created') && !l.startsWith('updated') && !l.startsWith('<!--'));
		return lines.length >= 3;
	} catch { return false; }
}

function getContextPct() {
	try {
		const raw = fs.readFileSync('/tmp/relaygent-context-pct', 'utf-8').trim();
		const pct = parseInt(raw, 10);
		return isNaN(pct) ? null : pct;
	} catch { return null; }
}

export async function load() {
	const topics = listTopics();
	const relayActivity = getRelayActivity();
	const services = await getServiceHealth();

	const currentTasks = await getCurrentTasks();

	return {
		topicCount: topics.length,
		attentionItems: getAttentionItems(),
		currentTasks,
		relayActivity: relayActivity?.recentActivity || [],
		contextPct: getContextPct(),
		services,
		relayRunning: isRelayRunning(),
		hasIntent: hasIntentContent(),
	};
}

import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import { findLatestSession, parseSession } from '$lib/relayActivity.js';

const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(process.env.HOME, 'projects', 'relaygent', 'data');
const STATUS_FILE = process.env.RELAY_STATUS_FILE || path.join(DATA_DIR, 'relay-status.json');

function getRelayStatus() {
	try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); }
	catch { return { status: 'off' }; }
}

/** Parse JSONL directly for live stats (no caching — always fresh). */
function parseLiveStats(jsonlPath) {
	const content = fs.readFileSync(jsonlPath, 'utf-8');
	const lines = content.trim().split('\n');

	let startTs = null, endTs = null, lastInputTokens = 0;
	const tools = {};
	let toolCalls = 0, turns = 0;
	const filesRead = new Set(), filesModified = new Set();

	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			const ts = entry.timestamp;
			if (ts) { if (!startTs) startTs = ts; endTs = ts; }

			if (entry.type !== 'assistant') continue;
			turns++;
			const usage = entry.message?.usage;
			if (usage) {
				// input_tokens is the full context size at this turn (not incremental)
				lastInputTokens = (usage.input_tokens || 0)
					+ (usage.cache_creation_input_tokens || 0)
					+ (usage.cache_read_input_tokens || 0);
			}
			const items = entry.message?.content;
			if (!Array.isArray(items)) continue;
			for (const item of items) {
				if (item?.type !== 'tool_use') continue;
				const name = item.name || 'unknown';
				tools[name] = (tools[name] || 0) + 1;
				toolCalls++;
				const fp = item.input?.file_path || item.input?.path;
				if (fp) {
					if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') filesModified.add(fp);
					else filesRead.add(fp);
				}
			}
		} catch { /* skip bad lines */ }
	}

	if (!startTs) return null;
	const durationMin = Math.round((new Date(endTs) - new Date(startTs)) / 60000);
	const topTools = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 8);

	return {
		startTime: startTs, durationMin, turns, toolCalls,
		contextPct: Math.round(lastInputTokens / 2000),
		topTools: Object.fromEntries(topTools),
		filesModified: [...filesModified].slice(0, 15),
		filesRead: [...filesRead].filter(f => !filesModified.has(f)).slice(0, 15),
	};
}

/** GET /api/session/live — current session stats (no caching). */
export function GET() {
	const relay = getRelayStatus();
	const sessionFile = findLatestSession();
	if (!sessionFile) return json({ active: false, status: relay.status || 'off' });

	try {
		const stats = parseLiveStats(sessionFile);
		if (!stats) return json({ active: false, status: relay.status || 'off' });

		const activity = parseSession(sessionFile, 30);
		const recent = activity.slice(-5).reverse().map(a => ({
			type: a.type, name: a.name, input: a.input, time: a.time,
		}));

		return json({
			active: relay.status === 'working',
			status: relay.status || 'unknown',
			sessionId: relay.session_id || null,
			...stats, recentTools: recent,
		});
	} catch { return json({ active: false, status: relay.status || 'off' }); }
}

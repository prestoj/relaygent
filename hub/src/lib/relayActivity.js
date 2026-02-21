import fs from 'fs';
import path from 'path';
import { parseSessionStats } from './relayStats.js';
export { summarizeInput, extractResultText, summarizeResult } from './activityFormat.js';
import { summarizeInput, extractResultText, summarizeResult } from './activityFormat.js';

function getRunsPrefix() {
	try {
		const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.relaygent', 'config.json'), 'utf-8'));
		return path.join(cfg.paths.repo, 'harness', 'runs').replace(/[/.]/g, '-');
	} catch { return null; }
}

export function findLatestSession() {
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	const prefix = getRunsPrefix();
	let latestSession = null;
	let latestTime = 0;

	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fstat = fs.statSync(path.join(fullPath, f));
				if (fstat.mtimeMs > latestTime && fstat.size > 200) {
					latestTime = fstat.mtimeMs;
					latestSession = path.join(fullPath, f);
				}
			}
		}
	} catch { /* ignore */ }

	return latestSession;
}

/** Parse session JSONL into activity items with tool results matched. */
export function parseSession(sessionFile, lastN = 150) {
	const activity = [];
	const toolResults = new Map();

	try {
		const content = fs.readFileSync(sessionFile, 'utf-8');
		const lines = content.trim().split('\n').slice(-lastN);

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'user' && entry.message?.content) {
					const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
					for (const item of items) {
						if (item?.type === 'tool_result' && item.tool_use_id) {
							toolResults.set(item.tool_use_id, item.content);
						}
					}
				}
			} catch { /* skip */ }
		}

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'assistant' && entry.message?.content) {
					const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
					for (const item of items) {
						if (item?.type === 'tool_use') {
							const result = toolResults.get(item.id);
							activity.push({
								type: 'tool', name: item.name, time: entry.timestamp,
								input: summarizeInput(item.name, item.input),
								params: item.input || {},
								result: summarizeResult(result),
								fullResult: extractResultText(result),
							});
						} else if (item?.type === 'text' && item.text?.length > 10) {
							activity.push({ type: 'text', time: entry.timestamp, text: item.text });
						}
					}
				}
			} catch { /* skip */ }
		}
	} catch { /* ignore */ }

	return activity;
}

export function getRelayActivity() {
	const latestSession = findLatestSession();
	if (!latestSession) return null;

	const activity = parseSession(latestSession, 100);
	const stat = fs.statSync(latestSession);
	const runMatch = latestSession.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})/);
	const runTime = runMatch ? `${runMatch[1]} ${runMatch[2]}:${runMatch[3]}` : 'Unknown';

	return {
		runTime,
		lastActivity: stat.mtimeMs ? new Date(stat.mtimeMs).toISOString() : null,
		recentActivity: activity.slice(-15).reverse(),
	};
}

let _sessionsCache = null; // { home, time, result }
const SESSIONS_TTL = 30_000;
export function clearSessionsCache() { _sessionsCache = null; }

/** List all relay sessions, newest first. Each entry: { id, displayTime, size }. */
export function listSessions() {
	const home = process.env.HOME;
	if (_sessionsCache && _sessionsCache.home === home && Date.now() - _sessionsCache.time < SESSIONS_TTL) {
		return _sessionsCache.result;
	}
	const claudeProjects = path.join(home, '.claude', 'projects');
	const prefix = getRunsPrefix();
	const sessions = [];
	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			let best = null, maxSize = 0;
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fp = path.join(fullPath, f);
				const sz = fs.statSync(fp).size;
				if (sz > maxSize) { maxSize = sz; best = fp; }
			}
			if (!best || maxSize < 200) continue;
			const m = dir.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
			if (!m) continue;
			const st = parseSessionStats(best) || {};
			sessions.push({ id: m[0], displayTime: `${m[1]} ${m[2]}:${m[3]}`, size: maxSize, durationMin: st.durationMin, totalTokens: st.totalTokens, toolCalls: st.toolCalls, summary: st.handoffGoal || st.firstText || null });
		}
	} catch { /* ignore */ }
	const result = sessions.sort((a, b) => b.id.localeCompare(a.id));
	_sessionsCache = { home, time: Date.now(), result };
	return result;
}

/** Load a session by id (timestamp suffix of run dir). Returns parsed activity array. */
export function loadSession(id) {
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	const prefix = getRunsPrefix();
	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			if (!dir.endsWith(id)) continue;
			const fullPath = path.join(claudeProjects, dir);
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fp = path.join(fullPath, f);
				if (fs.statSync(fp).size > 200) return { activity: parseSession(fp, 500), stats: parseSessionStats(fp) };
			}
		}
	} catch { /* ignore */ }
	return null;
}

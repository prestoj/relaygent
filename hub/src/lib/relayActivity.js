import fs from 'fs';
import path from 'path';
import { parseSessionStats, flushStatsCache } from './relayStats.js';
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
	let latestId = '';

	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			const m = dir.match(/(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})$/);
			if (!m) continue;
			const id = m[1];
			if (id <= latestId) continue;
			let best = null, bestMtime = 0;
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fp = path.join(fullPath, f);
				const st = fs.statSync(fp);
				if (st.size > 200 && st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = fp; }
			}
			if (best) { latestId = id; latestSession = best; }
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

/** List all relay sessions (one per JSONL file), newest first. */
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
			const m = dir.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
			if (!m) continue;
			const runId = m[0];
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fp = path.join(fullPath, f);
				const fst = fs.statSync(fp);
				if (fst.size < 200) continue;
				const uuid8 = f.slice(0, -6).slice(0, 8);
				const id = `${runId}--${uuid8}`;
				const st = parseSessionStats(fp) || {};
				const displayTime = st.start ? st.start.replace('T', ' ').slice(0, 16) : `${m[1]} ${m[2]}:${m[3]}`;
				sessions.push({ id, displayTime, size: fst.size, durationMin: st.durationMin, totalTokens: st.totalTokens, toolCalls: st.toolCalls, summary: st.handoffGoal || st.firstText || null });
			}
		}
	} catch { /* ignore */ }
	flushStatsCache();
	const result = sessions.sort((a, b) => b.displayTime.localeCompare(a.displayTime));
	_sessionsCache = { home, time: Date.now(), result };
	return result;
}

/** Load a session by id. Accepts "runTimestamp--uuid8" or legacy "runTimestamp". */
export function loadSession(id) {
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	const prefix = getRunsPrefix();
	const [runId, uuid8] = id.includes('--') ? id.split('--') : [id, null];
	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			if (!dir.endsWith(runId)) continue;
			const fullPath = path.join(claudeProjects, dir);
			if (uuid8) {
				for (const f of fs.readdirSync(fullPath)) {
					if (f.startsWith(uuid8) && f.endsWith('.jsonl')) {
						const fp = path.join(fullPath, f);
						return { activity: parseSession(fp, 500), stats: parseSessionStats(fp) };
					}
				}
			}
			let best = null, bestMtime = 0;
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fp = path.join(fullPath, f);
				const st = fs.statSync(fp);
				if (st.size > 200 && st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = fp; }
			}
			if (best) return { activity: parseSession(best, 500), stats: parseSessionStats(best) };
		}
	} catch { /* ignore */ }
	return null;
}

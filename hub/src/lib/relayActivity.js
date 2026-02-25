import fs from 'fs';
import path from 'path';
export { summarizeInput, extractResultText, summarizeResult } from './activityFormat.js';
export { listSessions, loadSession, clearSessionsCache } from './sessionList.js';
import { summarizeInput, extractResultText, summarizeResult } from './activityFormat.js';

/** Format ISO timestamp to local time: "YYYY-MM-DD HH:MM" */
export function fmtLocal(iso) {
	const d = new Date(iso);
	if (isNaN(d)) return iso;
	const pad = n => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function getRunsPrefix() {
	try {
		const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.relaygent', 'config.json'), 'utf-8'));
		return path.join(cfg.paths.repo, 'harness', 'runs').replace(/[/.]/g, '-');
	} catch { return null; }
}

const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(process.env.HOME, 'projects', 'relaygent', 'data');
const STATUS_FILE = process.env.RELAY_STATUS_FILE || path.join(DATA_DIR, 'relay-status.json');

/** Find the JSONL for the current relay session using session_id from relay-status.json. */
export function findCurrentSession() {
	const sessionId = getActiveSessionId();
	if (sessionId) {
		const found = findSessionById(sessionId);
		if (found) return found;
	}
	return findLatestSession();
}

function getActiveSessionId() {
	try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')).session_id || null; }
	catch { return null; }
}

function findSessionById(sessionId) {
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	const prefix = getRunsPrefix();
	const fname = `${sessionId}.jsonl`;
	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			const fp = path.join(fullPath, fname);
			try { if (fs.statSync(fp).size > 200) return fp; } catch { continue; }
		}
	} catch { /* ignore */ }
	return null;
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
	const latestSession = findCurrentSession();
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


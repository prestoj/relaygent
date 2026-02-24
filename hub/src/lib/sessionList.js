import fs from 'fs';
import path from 'path';
import { getRunsPrefix, parseSession, fmtLocal } from './relayActivity.js';
import { parseSessionStats, flushStatsCache } from './relayStats.js';

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
				const displayTime = st.start ? fmtLocal(st.start) : `${m[1]} ${m[2]}:${m[3]}`;
				sessions.push({ id, displayTime, size: fst.size, durationMin: st.durationMin, totalTokens: st.totalTokens, outputTokens: st.outputTokens || 0, inputTokens: st.inputTokens || 0, cacheWriteTokens: st.cacheWriteTokens || 0, cacheReadTokens: st.cacheReadTokens || 0, model: st.model || null, toolCalls: st.toolCalls, summary: st.handoffGoal || st.firstText || null, git_commits: st.git_commits || 0, prs_created: st.prs_created || [], prs_merged: st.prs_merged || [] });
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

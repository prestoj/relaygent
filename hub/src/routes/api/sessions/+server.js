import { readFileSync } from 'fs';
import path from 'path';
import { listSessions } from '$lib/relayActivity.js';

const REPO_DIR = process.env.RELAYGENT_REPO_DIR || path.resolve('.');
const SUMMARIES_DIR = path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'session-summaries');

function loadSessionSummary(id) {
	try { return JSON.parse(readFileSync(path.join(SUMMARIES_DIR, `${id}.json`), 'utf-8')); } catch { return null; }
}

/** GET /api/sessions?limit=N&offset=N — list recent sessions with metadata */
export async function GET({ url }) {
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0', 10);
	const all = listSessions();
	const sessions = all.slice(offset, offset + limit).map(s => {
		const stats = loadSessionSummary(s.id);
		return {
			id: s.id,
			time: s.displayTime,
			durationMin: s.durationMin || 0,
			tokens: s.totalTokens || 0,
			tools: s.toolCalls || 0,
			summary: s.summary || null,
			stats: stats ? {
				turns: stats.turns,
				contextPct: stats.context_pct,
				topTools: stats.tools,
			} : null,
			gitCommits: stats?.git_commits || s.git_commits || 0,
			prsCreated: stats?.prs_created || s.prs_created || [],
			prsMerged: stats?.prs_merged || s.prs_merged || [],
		};
	});
	return new Response(JSON.stringify({
		sessions, total: all.length, offset, limit,
		hasMore: offset + limit < all.length,
	}), { headers: { 'Content-Type': 'application/json' } });
}

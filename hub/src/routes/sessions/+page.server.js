import { readFileSync } from 'fs';
import path from 'path';
import { listSessions } from '$lib/relayActivity.js';

const REPO_DIR = process.env.RELAYGENT_REPO_DIR || path.resolve('.');
const SUMMARIES_DIR = path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'session-summaries');
const PAGE_SIZE = 50;

function loadStats(id) {
	try { return JSON.parse(readFileSync(path.join(SUMMARIES_DIR, `${id}.json`), 'utf-8')); } catch { return null; }
}

export function load({ url } = {}) {
	const all = listSessions();
	const showAll = url?.searchParams?.get('all') === '1';
	const sessions = (showAll ? all : all.slice(0, PAGE_SIZE)).map(s => {
		const st = loadStats(s.id);
		return { ...s, gitCommits: st?.git_commits || 0, prsCreated: st?.prs_created?.length || 0, prsMerged: st?.prs_merged?.length || 0 };
	});
	const totalTokens = all.reduce((s, x) => s + (x.totalTokens || 0), 0);
	const durations = all.map(x => x.durationMin).filter(d => d > 0);
	const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
	const stats = { totalSessions: all.length, totalTokens, avgDuration, topTools: [] };
	return { sessions, stats, total: all.length, truncated: !showAll && all.length > PAGE_SIZE };
}

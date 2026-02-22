import { listSessions } from '$lib/relayActivity.js';

const PAGE_SIZE = 50;

export function load({ url } = {}) {
	const all = listSessions();
	const showAll = url?.searchParams?.get('all') === '1';
	const sessions = showAll ? all : all.slice(0, PAGE_SIZE);
	const totalTokens = all.reduce((s, x) => s + (x.totalTokens || 0), 0);
	const durations = all.map(x => x.durationMin).filter(d => d > 0);
	const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
	const tools = {};
	const stats = { totalSessions: all.length, totalTokens, avgDuration, topTools: [] };
	return { sessions, stats, total: all.length, truncated: !showAll && all.length > PAGE_SIZE };
}

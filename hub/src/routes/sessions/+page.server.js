import { listSessions } from '$lib/relayActivity.js';
import { getRelayStats } from '$lib/relayStats.js';

const PAGE_SIZE = 50;

export function load({ url } = {}) {
	const all = listSessions();
	const showAll = url?.searchParams?.get('all') === '1';
	const sessions = showAll ? all : all.slice(0, PAGE_SIZE);
	return { sessions, stats: getRelayStats(), total: all.length, truncated: !showAll && all.length > PAGE_SIZE };
}

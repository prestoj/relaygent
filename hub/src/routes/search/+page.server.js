import { searchTopics } from '$lib/kb.js';
import { searchSessions } from '$lib/sessionSearch.js';

export async function load({ url }) {
	const q = url.searchParams.get('q') || '';
	const kbResults = searchTopics(q);
	const sessionResults = q.length >= 2 ? searchSessions(q) : [];
	return { query: q, results: [...kbResults, ...sessionResults] };
}

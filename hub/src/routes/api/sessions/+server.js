import { listSessions } from '$lib/relayActivity.js';

/** GET /api/sessions?limit=N&offset=N — list recent sessions with metadata */
export async function GET({ url }) {
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0', 10);
	const all = listSessions();
	const sessions = all.slice(offset, offset + limit).map(s => ({
		id: s.id,
		time: s.displayTime,
		durationMin: s.durationMin || 0,
		tokens: s.totalTokens || 0,
		tools: s.toolCalls || 0,
		summary: s.summary || null,
	}));
	return new Response(JSON.stringify({
		sessions, total: all.length, offset, limit,
		hasMore: offset + limit < all.length,
	}), { headers: { 'Content-Type': 'application/json' } });
}

import { json } from '@sveltejs/kit';
import { findCurrentSession, parseSession } from '$lib/relayActivity.js';

/** GET /api/session/activity?offset=0&limit=20 — paginated activity for current session. */
export function GET({ url }) {
	const offset = parseInt(url.searchParams.get('offset') || '0', 10);
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
	const sessionFile = findCurrentSession();
	if (!sessionFile) return json({ items: [], total: 0 });

	try {
		const all = parseSession(sessionFile, 500);
		// Reverse so newest first (matches sidebar display order)
		all.reverse();
		const items = all.slice(offset, offset + limit);
		return json({ items, total: all.length, hasMore: offset + limit < all.length });
	} catch { return json({ items: [], total: 0 }); }
}

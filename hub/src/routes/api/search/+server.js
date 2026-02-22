import { json } from '@sveltejs/kit';
import { searchTopics } from '$lib/kb.js';
import { searchSessions } from '$lib/sessionSearch.js';
import { searchMessages } from '$lib/chat.js';

/** GET /api/search?q=query&full=1 — search for command palette or full search page */
export function GET({ url }) {
	const q = url.searchParams.get('q') || '';
	const full = url.searchParams.get('full') === '1';
	if (q.length < 2) return json({ results: [] });
	const topics = searchTopics(q).slice(0, full ? 20 : 8).map(t => ({
		title: t.title || t.slug, slug: t.slug, tags: t.tags || [], type: 'topic',
		snippet: t.snippet || '',
	}));
	if (!full) return json({ results: topics });
	const sessions = searchSessions(q).map(s => ({ ...s, type: 'session' }));
	const chats = searchMessages(q, 5).map(m => ({
		type: 'chat', role: m.role, snippet: m.content.length > 120 ? m.content.slice(0, 120) + '...' : m.content,
		time: m.created_at,
	}));
	return json({ results: [...topics, ...sessions, ...chats] });
}

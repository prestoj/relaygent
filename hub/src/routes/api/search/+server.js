import { json } from '@sveltejs/kit';
import { searchTopics } from '$lib/kb.js';

/** GET /api/search?q=query — lightweight search for command palette */
export function GET({ url }) {
	const q = url.searchParams.get('q') || '';
	if (q.length < 2) return json({ results: [] });
	const topics = searchTopics(q).slice(0, 8).map(t => ({
		title: t.title || t.slug, slug: t.slug, tags: t.tags || [],
	}));
	return json({ results: topics });
}

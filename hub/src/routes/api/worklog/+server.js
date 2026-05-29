import { json } from '@sveltejs/kit';
import { appendEntry, listEntries } from '$lib/worklog.js';

// GET /api/worklog?limit=200 → newest-first entries.
export function GET({ url }) {
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);
	return json({ entries: listEntries({ limit }) });
}

// POST /api/worklog {title, detail?, kind?, link?, ts?} → append one entry.
// Localhost bypasses the auth hook, so the `worklog` CLI can post freely.
export async function POST({ request }) {
	let body;
	try { body = await request.json(); } catch { return json({ error: 'bad json' }, { status: 400 }); }
	const res = appendEntry(body);
	if (res.error) return json(res, { status: 400 });
	return json(res, { status: 201 });
}

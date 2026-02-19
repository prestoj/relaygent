import { loadSession } from '$lib/relayActivity.js';
import { error } from '@sveltejs/kit';

export function load({ params }) {
	const activity = loadSession(params.id);
	if (!activity) throw error(404, 'Session not found');
	// Format id as readable time: "2026-02-19-09-33-21" → "2026-02-19 09:33"
	const m = params.id.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})/);
	const displayTime = m ? `${m[1]} ${m[2]}:${m[3]}` : params.id;
	return { id: params.id, displayTime, activity };
}

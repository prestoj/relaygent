import { loadSession } from '$lib/relayActivity.js';
import { error } from '@sveltejs/kit';

const SESSION_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/;

export function load({ params }) {
	const m = SESSION_ID_RE.exec(params.id);
	if (!m) throw error(404, 'Session not found');
	const result = loadSession(params.id);
	if (!result) throw error(404, 'Session not found');
	const displayTime = `${m[1]} ${m[2]}:${m[3]}`;
	return { id: params.id, displayTime, activity: result.activity, summary: result.stats?.firstText || null };
}

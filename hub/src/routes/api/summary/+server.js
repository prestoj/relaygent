import { json } from '@sveltejs/kit';
import { summarizeCurrent, summarizeSession } from '$lib/sessionSummary.js';
import { loadSession } from '$lib/relayActivity.js';

const SESSION_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(--[a-f0-9]{8})?$/;

/** GET /api/summary?session=current or ?session=<id> */
export async function GET({ url }) {
	const session = url.searchParams.get('session') || 'current';

	try {
		if (session === 'current') {
			const summary = await summarizeCurrent();
			if (!summary) return json({ summary: null, error: 'No active session or too little activity' });
			return json({ summary });
		}

		if (!SESSION_ID_RE.test(session)) {
			return json({ error: 'Invalid session ID format' }, { status: 400 });
		}

		const result = loadSession(session);
		if (!result) return json({ error: 'Session not found' }, { status: 404 });

		const summary = await summarizeSession(session, result.activity);
		return json({ summary });
	} catch (err) {
		const msg = err.message || 'Summary generation failed';
		return json({ error: msg }, { status: 500 });
	}
}

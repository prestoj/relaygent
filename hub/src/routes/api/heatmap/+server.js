import { json } from '@sveltejs/kit';
import { listSessions } from '$lib/relayActivity.js';

/** GET /api/heatmap — daily session counts for activity heatmap */
export function GET() {
	const sessions = listSessions();
	const counts = {};
	for (const s of sessions) {
		const m = s.id.match(/^(\d{4}-\d{2}-\d{2})/);
		if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
	}
	// Build 12 weeks of data
	const days = [];
	const now = new Date();
	for (let i = 83; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		days.push({ date: key, count: counts[key] || 0, dow: d.getDay() });
	}
	return json({ days, total: sessions.length });
}

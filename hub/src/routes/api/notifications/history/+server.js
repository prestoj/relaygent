import { json } from '@sveltejs/kit';

const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const NOTIF_URL = `http://127.0.0.1:${NOTIF_PORT}`;

/** GET /api/notifications/history — fetch notification history */
export async function GET({ url }) {
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
	const offset = parseInt(url.searchParams.get('offset') || '0', 10);
	try {
		const res = await fetch(
			`${NOTIF_URL}/notifications/history?limit=${limit}&offset=${offset}`,
			{ signal: AbortSignal.timeout(5000) }
		);
		const data = await res.json();
		return json(data);
	} catch {
		return json({ entries: [], error: 'Notifications service unreachable' });
	}
}

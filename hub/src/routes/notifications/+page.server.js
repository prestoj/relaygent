const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const NOTIF_URL = `http://127.0.0.1:${NOTIF_PORT}`;

export async function load({ url }) {
	const limit = 50;
	const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1);
	const offset = (page - 1) * limit;
	try {
		const res = await fetch(
			`${NOTIF_URL}/notifications/history?limit=${limit}&offset=${offset}`,
			{ signal: AbortSignal.timeout(5000) }
		);
		const data = await res.json();
		return { entries: data.entries || [], page, limit, hasMore: (data.entries || []).length === limit };
	} catch {
		return { entries: [], page, limit, hasMore: false, error: 'Notifications service unreachable' };
	}
}

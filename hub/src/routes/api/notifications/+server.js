import { json } from '@sveltejs/kit';

const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const NOTIF_URL = `http://127.0.0.1:${NOTIF_PORT}`;

async function proxy(path, method = 'GET', body = null) {
	const opts = { method, headers: { 'Content-Type': 'application/json' } };
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${NOTIF_URL}${path}`, opts);
	return { data: await res.json(), status: res.status };
}

/** GET /api/notifications — list upcoming reminders */
export async function GET() {
	try {
		const { data } = await proxy('/upcoming');
		return json({ reminders: data });
	} catch (e) {
		return json({ reminders: [], error: 'Notifications service unreachable' });
	}
}

/** POST /api/notifications — create a reminder */
export async function POST({ request }) {
	let data;
	try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }
	if (!data.trigger_time || !data.message) {
		return json({ error: 'trigger_time and message required' }, { status: 400 });
	}
	try {
		const { data: result, status } = await proxy('/reminder', 'POST', data);
		return json(result, { status });
	} catch (e) {
		return json({ error: 'Notifications service unreachable' }, { status: 502 });
	}
}

/** DELETE /api/notifications — cancel a reminder by id */
export async function DELETE({ url }) {
	const id = url.searchParams.get('id');
	if (!id || !/^\d+$/.test(id)) return json({ error: 'valid numeric id required' }, { status: 400 });
	try {
		const { data: result, status } = await proxy(`/reminder/${id}`, 'DELETE');
		return json(result, { status });
	} catch (e) {
		return json({ error: 'Notifications service unreachable' }, { status: 502 });
	}
}

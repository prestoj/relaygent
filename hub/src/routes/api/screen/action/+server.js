import { json } from '@sveltejs/kit';

const HS_PORT = process.env.HAMMERSPOON_PORT || '8097';
const BASE = `http://127.0.0.1:${HS_PORT}`;

const VALID_ACTIONS = {
	click:  ['x', 'y'],
	type:   [],          // text or key required (validated below)
	scroll: [],
	drag:   ['startX', 'startY', 'endX', 'endY'],
};

export async function POST({ request }) {
	let body;
	try { body = await request.json(); } catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const { action, ...params } = body;
	if (!action || !VALID_ACTIONS[action]) {
		return json({ error: `Invalid action. Valid: ${Object.keys(VALID_ACTIONS).join(', ')}` }, { status: 400 });
	}
	const required = VALID_ACTIONS[action];
	for (const field of required) {
		if (params[field] === undefined) {
			return json({ error: `Missing required field: ${field}` }, { status: 400 });
		}
	}
	if (action === 'type' && !params.text && !params.key) {
		return json({ error: 'type action requires text or key' }, { status: 400 });
	}
	try {
		const res = await fetch(`${BASE}/${action}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
			signal: AbortSignal.timeout(8000),
		});
		const data = await res.json();
		return json(data, { status: res.status });
	} catch {
		return json({ error: 'Computer-use backend unreachable' }, { status: 502 });
	}
}

import { json } from '@sveltejs/kit';
const FORUM_API = `http://localhost:${process.env.RELAYGENT_FORUM_PORT || '8085'}`;

export async function POST({ request, params }) {
	if (!/^\d+$/.test(params.id)) {
		return json({ error: 'Invalid post ID' }, { status: 400 });
	}
	const body = await request.json();
	const res = await fetch(`${FORUM_API}/posts/${params.id}/comments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json();
	return new Response(JSON.stringify(data), {
		status: res.status,
		headers: { 'Content-Type': 'application/json' }
	});
}

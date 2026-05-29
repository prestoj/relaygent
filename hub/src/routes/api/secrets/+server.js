import { json } from '@sveltejs/kit';
import { listSecretNames, setSecret, deleteSecret, isValidName } from '$lib/secrets.js';

/** GET /api/secrets — list secret NAMES only (never values). */
export function GET() {
	return json({ names: listSecretNames() });
}

/** POST /api/secrets — body { name, value }. Write-only; value is never read back. */
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const { name, value } = body || {};
	if (!isValidName(name)) {
		return json({ error: 'Invalid name (use letters, digits, _ or -)' }, { status: 400 });
	}
	if (typeof value !== 'string' || value === '') {
		return json({ error: 'Value required' }, { status: 400 });
	}
	if (!setSecret(name, value)) {
		return json({ error: 'Could not save secret' }, { status: 500 });
	}
	return json({ ok: true, name }, { status: 201 });
}

/** DELETE /api/secrets?name=foo */
export function DELETE({ url }) {
	const name = url.searchParams.get('name');
	if (!isValidName(name)) {
		return json({ error: 'Invalid name' }, { status: 400 });
	}
	return deleteSecret(name)
		? json({ ok: true })
		: json({ error: 'Not found' }, { status: 404 });
}

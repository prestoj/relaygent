import { json } from '@sveltejs/kit';
import { isConfigured, listTeams, listIssues, createIssue, updateIssue } from '$lib/linear.js';

const UUID_RE = /^[a-f0-9-]{36}$/i;
function validId(s) { return typeof s === 'string' && UUID_RE.test(s); }

/** GET /api/linear?action=issues|teams — read Linear data */
export async function GET({ url }) {
	if (!isConfigured()) return json({ error: 'Linear not configured' }, { status: 503 });
	const action = url.searchParams.get('action') || 'issues';
	try {
		if (action === 'teams') return json({ teams: await listTeams() });
		const teamId = url.searchParams.get('teamId') || undefined;
		if (teamId && !validId(teamId)) return json({ error: 'Invalid teamId' }, { status: 400 });
		const issues = await listIssues({ teamId });
		return json({ issues: issues.nodes, pageInfo: issues.pageInfo });
	} catch (e) {
		return json({ error: e.message }, { status: 500 });
	}
}

/** POST /api/linear — create or update an issue */
export async function POST({ request }) {
	if (!isConfigured()) return json({ error: 'Linear not configured' }, { status: 503 });
	try {
		const body = await request.json();
		if (body.action === 'update') {
			if (!validId(body.id)) return json({ error: 'Invalid issue id' }, { status: 400 });
			const { id, action: _, ...updates } = body;
			const result = await updateIssue(id, updates);
			return json(result);
		}
		if (!validId(body.teamId)) return json({ error: 'Invalid teamId' }, { status: 400 });
		if (!body.title?.trim() || body.title.length > 500) return json({ error: 'Title required (max 500 chars)' }, { status: 400 });
		const result = await createIssue(body);
		return json(result, { status: 201 });
	} catch (e) {
		return json({ error: e.message }, { status: 500 });
	}
}

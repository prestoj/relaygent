import { json } from '@sveltejs/kit';
import { createRequire } from 'module';
import { isConfigured, listTeams, listIssues, createIssue, updateIssue } from '$lib/linear.js';

/** GET /api/linear?action=issues|teams — read Linear data */
export async function GET({ url }) {
	if (!isConfigured()) return json({ error: 'Linear not configured' }, { status: 503 });
	const action = url.searchParams.get('action') || 'issues';
	try {
		if (action === 'teams') return json({ teams: await listTeams() });
		const teamId = url.searchParams.get('teamId') || undefined;
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
			const { id, ...updates } = body;
			const result = await updateIssue(id, updates);
			return json(result);
		}
		const result = await createIssue(body);
		return json(result, { status: 201 });
	} catch (e) {
		return json({ error: e.message }, { status: 500 });
	}
}

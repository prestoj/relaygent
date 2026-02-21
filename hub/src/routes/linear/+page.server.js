import { isConfigured, listTeams, listIssues } from '$lib/linear.js';

export async function load() {
	if (!isConfigured()) return { configured: false, teams: [], issues: [] };
	try {
		const teams = await listTeams();
		const teamId = teams[0]?.id;
		const result = teamId ? await listIssues({ teamId }) : { nodes: [] };
		return { configured: true, teams, issues: result.nodes || [], activeTeamId: teamId };
	} catch (e) {
		return { configured: true, teams: [], issues: [], error: e.message };
	}
}

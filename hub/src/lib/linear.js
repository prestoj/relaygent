/**
 * Linear API client — wraps GraphQL queries for issue management.
 * API key stored at ~/.relaygent/linear/api-key (plain text).
 */
import fs from 'fs';
import path from 'path';

const API_URL = 'https://api.linear.app/graphql';
const KEY_PATH = path.join(process.env.HOME || '/tmp', '.relaygent', 'linear', 'api-key');

export function getApiKey() {
	try { return fs.readFileSync(KEY_PATH, 'utf-8').trim(); } catch { return null; }
}

export function isConfigured() { return !!getApiKey(); }

async function gql(query, variables = {}) {
	const key = getApiKey();
	if (!key) throw new Error('Linear API key not configured. Add key to ' + KEY_PATH);
	const res = await fetch(API_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: key },
		body: JSON.stringify({ query, variables }),
	});
	const json = await res.json();
	if (json.errors?.length) throw new Error(json.errors[0].message);
	return json.data;
}

export async function listTeams() {
	const data = await gql(`{ teams { nodes { id name key } } }`);
	return data.teams.nodes;
}

export async function listIssues({ teamId, first = 50, after } = {}) {
	const vars = { first };
	if (teamId) vars.teamId = teamId;
	if (after) vars.after = after;
	const teamDecl = teamId ? ', $teamId: String!' : '';
	const teamFilter = teamId ? ', filter: { team: { id: { eq: $teamId } } }' : '';
	const afterDecl = after ? ', $after: String' : '';
	const afterArg = after ? ', after: $after' : '';
	const data = await gql(`query($first: Int!${teamDecl}${afterDecl}) {
		issues(first: $first${afterArg}, orderBy: updatedAt${teamFilter}) {
			nodes {
				id identifier title description priority priorityLabel
				state { id name color type }
				assignee { id name }
				labels { nodes { id name color } }
				createdAt updatedAt
			}
			pageInfo { hasNextPage endCursor }
		}
	}`, vars);
	return data.issues;
}

export async function getIssue(id) {
	const data = await gql(`query($id: String!) {
		issue(id: $id) {
			id identifier title description priority priorityLabel
			state { id name color type }
			assignee { id name }
			labels { nodes { id name color } }
			comments { nodes { id body user { name } createdAt } }
			createdAt updatedAt
		}
	}`, { id });
	return data.issue;
}

export async function createIssue({ teamId, title, description, priority, labelIds, assigneeId }) {
	const input = { teamId, title };
	if (description) input.description = description;
	if (priority != null) input.priority = priority;
	if (labelIds?.length) input.labelIds = labelIds;
	if (assigneeId) input.assigneeId = assigneeId;
	const data = await gql(`mutation($input: IssueCreateInput!) {
		issueCreate(input: $input) { success issue { id identifier title state { name } } }
	}`, { input });
	return data.issueCreate;
}

export async function updateIssue(id, updates) {
	const data = await gql(`mutation($id: String!, $input: IssueUpdateInput!) {
		issueUpdate(id: $id, input: $input) { success issue { id identifier title state { name } } }
	}`, { id, input: updates });
	return data.issueUpdate;
}

export async function listStates(teamId) {
	const data = await gql(`query($teamId: String!) {
		workflowStates(filter: { team: { id: { eq: $teamId } } }) {
			nodes { id name color type position }
		}
	}`, { teamId });
	return data.workflowStates.nodes.sort((a, b) => a.position - b.position);
}

export async function listLabels(teamId) {
	if (teamId) {
		const data = await gql(`query($teamId: String!) {
			issueLabels(filter: { team: { id: { eq: $teamId } } }) { nodes { id name color } }
		}`, { teamId });
		return data.issueLabels.nodes;
	}
	const data = await gql(`{ issueLabels { nodes { id name color } } }`);
	return data.issueLabels.nodes;
}

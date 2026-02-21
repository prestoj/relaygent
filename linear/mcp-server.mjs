#!/usr/bin/env node
/**
 * Linear MCP server — manage issues, teams, and labels via Linear's GraphQL API.
 * API key stored at ~/.relaygent/linear/api-key (plain text).
 * Reuses the Linear client from hub/src/lib/linear.js.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	isConfigured, listTeams, listIssues, getIssue,
	createIssue, updateIssue, listStates, listLabels,
} from "../hub/src/lib/linear.js";

const server = new McpServer({ name: "linear", version: "1.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });

function checkConfigured() {
	if (!isConfigured()) throw new Error("Linear API key not configured. Save key to ~/.relaygent/linear/api-key");
}

function fmtIssue(i) {
	const assignee = i.assignee?.name || "unassigned";
	const labels = (i.labels?.nodes || []).map(l => l.name).join(", ");
	const state = i.state?.name || "?";
	let s = `${i.identifier} [${state}] ${i.title} (${assignee})`;
	if (labels) s += ` {${labels}}`;
	if (i.description) s += `\n  ${i.description.slice(0, 200)}`;
	return s;
}

server.tool("list_teams", "List Linear teams in the workspace.", {}, async () => {
	try {
		checkConfigured();
		const teams = await listTeams();
		if (!teams.length) return txt("No teams found.");
		return txt(teams.map(t => `${t.name} (key: ${t.key}, id: ${t.id})`).join("\n"));
	} catch (e) { return txt(`Error: ${e.message}`); }
});

server.tool("list_issues",
	"List Linear issues. Filter by team, state type, or assignee.",
	{
		team_id: z.string().optional().describe("Team UUID to filter by"),
		first: z.number().default(25).describe("Max issues to return (default 25)"),
	},
	async ({ team_id, first }) => {
		try {
			checkConfigured();
			const result = await listIssues({ teamId: team_id, first });
			const issues = result.nodes || [];
			if (!issues.length) return txt("No issues found.");
			const lines = issues.map(fmtIssue);
			const more = result.pageInfo?.hasNextPage ? `\n(more available)` : "";
			return txt(lines.join("\n") + more);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("get_issue", "Get details of a specific Linear issue by ID.",
	{ issue_id: z.string().describe("Issue UUID") },
	async ({ issue_id }) => {
		try {
			checkConfigured();
			const i = await getIssue(issue_id);
			if (!i) return txt("Issue not found.");
			let s = fmtIssue(i);
			const comments = i.comments?.nodes || [];
			if (comments.length) {
				s += "\n\nComments:";
				for (const c of comments.slice(0, 10)) {
					s += `\n  [${c.user?.name || "?"}] ${c.body?.slice(0, 200) || ""}`;
				}
			}
			return txt(s);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("create_issue", "Create a new Linear issue.",
	{
		team_id: z.string().describe("Team UUID (required)"),
		title: z.string().max(500).describe("Issue title"),
		description: z.string().optional().describe("Issue description (markdown)"),
		priority: z.number().min(0).max(4).optional().describe("Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low"),
		assignee_id: z.string().optional().describe("Assignee user UUID"),
		label_ids: z.array(z.string()).optional().describe("Label UUIDs to attach"),
	},
	async ({ team_id, title, description, priority, assignee_id, label_ids }) => {
		try {
			checkConfigured();
			const result = await createIssue({
				teamId: team_id, title, description, priority,
				assigneeId: assignee_id, labelIds: label_ids,
			});
			if (!result.success) return txt("Failed to create issue.");
			const i = result.issue;
			return txt(`Created ${i.identifier}: ${i.title} [${i.state?.name}]`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("update_issue", "Update a Linear issue (status, assignee, title, etc.).",
	{
		issue_id: z.string().describe("Issue UUID"),
		title: z.string().optional().describe("New title"),
		description: z.string().optional().describe("New description"),
		state_id: z.string().optional().describe("New state UUID (use list_states to find IDs)"),
		assignee_id: z.string().optional().describe("New assignee UUID"),
		priority: z.number().min(0).max(4).optional().describe("New priority"),
	},
	async ({ issue_id, title, description, state_id, assignee_id, priority }) => {
		try {
			checkConfigured();
			const input = {};
			if (title) input.title = title;
			if (description) input.description = description;
			if (state_id) input.stateId = state_id;
			if (assignee_id) input.assigneeId = assignee_id;
			if (priority != null) input.priority = priority;
			const result = await updateIssue(issue_id, input);
			if (!result.success) return txt("Failed to update issue.");
			const i = result.issue;
			return txt(`Updated ${i.identifier}: ${i.title} [${i.state?.name}]`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("list_states", "List workflow states for a team (Backlog, Todo, In Progress, Done, etc.).",
	{ team_id: z.string().describe("Team UUID") },
	async ({ team_id }) => {
		try {
			checkConfigured();
			const states = await listStates(team_id);
			return txt(states.map(s => `${s.name} (type: ${s.type}, id: ${s.id})`).join("\n"));
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("list_labels", "List issue labels, optionally filtered by team.",
	{ team_id: z.string().optional().describe("Team UUID (optional)") },
	async ({ team_id }) => {
		try {
			checkConfigured();
			const labels = await listLabels(team_id);
			if (!labels.length) return txt("No labels found.");
			return txt(labels.map(l => `${l.name} (id: ${l.id})`).join("\n"));
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);

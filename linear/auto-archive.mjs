#!/usr/bin/env node
/**
 * Auto-archive completed/canceled Linear issues older than N days.
 * Keeps the active issue count under Linear's free-tier 250 limit.
 *
 * Usage: node linear/auto-archive.mjs [--days 7] [--dry-run] [--team TEAM_ID]
 */
import { isConfigured, listIssues, archiveIssue } from '../hub/src/lib/linear.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 7;
const teamIdx = args.indexOf('--team');
const teamId = teamIdx >= 0 ? args[teamIdx + 1] : undefined;

if (!isConfigured()) { console.error('Linear API key not configured.'); process.exit(1); }

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const ARCHIVE_TYPES = new Set(['completed', 'canceled']);

let archived = 0, cursor = undefined;
for (let page = 0; page < 10; page++) {
	const result = await listIssues({ teamId, first: 50, after: cursor });
	const issues = result.nodes || [];
	for (const issue of issues) {
		if (!ARCHIVE_TYPES.has(issue.state?.type)) continue;
		if (new Date(issue.updatedAt).getTime() > cutoff) continue;
		if (dryRun) {
			console.log(`[dry-run] Would archive ${issue.identifier}: ${issue.title}`);
		} else {
			const r = await archiveIssue(issue.id);
			if (r.success) console.log(`Archived ${issue.identifier}: ${issue.title}`);
			else console.error(`Failed to archive ${issue.identifier}`);
		}
		archived++;
	}
	if (!result.pageInfo?.hasNextPage) break;
	cursor = result.pageInfo.endCursor;
}

console.log(`${dryRun ? 'Would archive' : 'Archived'} ${archived} issue(s) older than ${days} day(s).`);

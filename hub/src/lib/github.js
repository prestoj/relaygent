/**
 * GitHub PR status via gh CLI.
 * Caches results for 60s to avoid hammering the API.
 * Gracefully returns empty if gh is unavailable.
 */
import { execFile } from 'child_process';

let cache = { data: null, ts: 0 };
const TTL = 60_000;

function gh(args) {
	return new Promise((resolve) => {
		execFile('gh', args, { timeout: 10_000 }, (err, stdout) => {
			if (err) return resolve(null);
			try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
		});
	});
}

export async function getOpenPRs() {
	if (cache.data && Date.now() - cache.ts < TTL) return cache.data;
	const raw = await gh([
		'pr', 'list', '--state', 'open', '--limit', '10',
		'--json', 'number,title,author,headRefName,createdAt,reviewDecision,statusCheckRollup',
	]);
	if (!raw) return cache.data || [];
	const prs = raw.map(pr => {
		const checks = (pr.statusCheckRollup || []);
		const total = checks.length;
		const pass = checks.filter(c => c.conclusion === 'SUCCESS').length;
		const fail = checks.filter(c => c.conclusion === 'FAILURE').length;
		const pending = total - pass - fail;
		let ci = 'none';
		if (total > 0) ci = fail > 0 ? 'fail' : pending > 0 ? 'pending' : 'pass';
		return {
			number: pr.number,
			title: pr.title,
			author: pr.author?.login || '?',
			branch: pr.headRefName,
			review: pr.reviewDecision || 'PENDING',
			ci,
			ciDetail: `${pass}/${total} passed${fail ? `, ${fail} failed` : ''}`,
			age: timeSince(pr.createdAt),
		};
	});
	cache.data = prs;
	cache.ts = Date.now();
	return prs;
}

function timeSince(iso) {
	const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.round(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	return `${Math.round(hrs / 24)}d`;
}

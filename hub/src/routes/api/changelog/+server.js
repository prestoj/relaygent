import { json } from '@sveltejs/kit';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let _cache = null, _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const EXEC_ENV = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };

function getRepoDir() {
	try {
		const cfg = JSON.parse(readFileSync(path.join(process.env.HOME, '.relaygent', 'config.json'), 'utf-8'));
		if (cfg.paths?.repo && existsSync(cfg.paths.repo)) return cfg.paths.repo;
	} catch {}
	return null;
}

function fetchChangelog(days = 7) {
	const repo = getRepoDir();
	if (!repo) return { prs: [], commits: 0, error: 'Repo not found' };
	const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
	try {
		const raw = execSync(
			`gh pr list --state merged --search "merged:>=${since}" --limit 50 --json number,title,mergedAt,author,headRefName`,
			{ cwd: repo, timeout: 10000, encoding: 'utf-8', env: EXEC_ENV }
		);
		const prs = JSON.parse(raw).map(p => ({
			number: p.number, title: p.title, mergedAt: p.mergedAt,
			author: p.author?.login || 'unknown', branch: p.headRefName,
		}));
		const commits = parseInt(execSync(
			`git log --oneline --since="${since}" | wc -l`,
			{ cwd: repo, timeout: 5000, encoding: 'utf-8', env: EXEC_ENV }
		).trim()) || 0;
		return { prs, commits, since };
	} catch (e) { return { prs: [], commits: 0, error: e.message }; }
}

/** GET /api/changelog?days=7 */
export function GET({ url }) {
	const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90);
	const now = Date.now();
	if (_cache && (now - _cacheTime) < CACHE_TTL && _cache.days === days) return json(_cache.data);
	const data = fetchChangelog(days);
	_cache = { data, days }; _cacheTime = now;
	return json(data);
}

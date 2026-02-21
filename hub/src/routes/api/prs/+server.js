import { json } from '@sveltejs/kit';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export async function GET() {
	try {
		const { stdout } = await exec('gh', [
			'pr', 'list', '--state', 'open', '--json',
			'number,title,author,reviewDecision,createdAt,headRefName',
			'--limit', '10',
		], { timeout: 10000 });
		const prs = JSON.parse(stdout).map(pr => ({
			number: pr.number,
			title: pr.title,
			author: pr.author?.login || '?',
			review: pr.reviewDecision || 'PENDING',
			branch: pr.headRefName,
			created: pr.createdAt,
		}));
		return json({ prs });
	} catch {
		return json({ prs: [], error: 'gh CLI unavailable' });
	}
}

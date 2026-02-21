import { json } from '@sveltejs/kit';
import { getOpenPRs } from '$lib/github.js';

/** GET /api/prs — open PRs with CI + review status */
export async function GET() {
	const prs = await getOpenPRs();
	return json({ prs });
}

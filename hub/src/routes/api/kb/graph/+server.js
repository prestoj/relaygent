import { getGraphData } from '$lib/kb.js';
import { json } from '@sveltejs/kit';

export function GET() {
	return json(getGraphData());
}

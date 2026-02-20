import { json } from '@sveltejs/kit';
import { getServiceHealth } from '$lib/serviceHealth.js';

/** GET /api/services — current service health for polling */
export async function GET() {
	const services = await getServiceHealth();
	return json({ services });
}

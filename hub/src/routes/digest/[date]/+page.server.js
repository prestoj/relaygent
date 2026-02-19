import { getDigest } from '$lib/digest.js';
import { error } from '@sveltejs/kit';

export function load({ params }) {
	try {
		return getDigest(params.date);
	} catch {
		error(404, 'Digest not found');
	}
}

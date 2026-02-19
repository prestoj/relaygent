import { listDigests } from '$lib/digest.js';

export function load() {
	return { dates: listDigests() };
}

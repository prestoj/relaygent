import { listFiles } from '$lib/files.js';

export function load() {
	return { files: listFiles() };
}

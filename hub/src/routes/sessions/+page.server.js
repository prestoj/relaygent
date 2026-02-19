import { listSessions } from '$lib/relayActivity.js';

export function load() {
	return { sessions: listSessions() };
}

import { listSessions } from '$lib/relayActivity.js';
import { getRelayStats } from '$lib/relayStats.js';

export function load() {
	return { sessions: listSessions(), stats: getRelayStats() };
}

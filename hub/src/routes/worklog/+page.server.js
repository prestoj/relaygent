import os from 'os';
import { listEntries, groupByDay } from '$lib/worklog.js';

export function load() {
	const entries = listEntries({ limit: 300 });
	// hostname, not a hardcoded agent name — worklog.jsonl is per-box.
	return { groups: groupByDay(entries), total: entries.length, hostname: os.hostname() };
}

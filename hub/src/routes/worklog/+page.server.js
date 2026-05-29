import { listEntries, groupByDay } from '$lib/worklog.js';

export function load() {
	const entries = listEntries({ limit: 300 });
	return { groups: groupByDay(entries), total: entries.length };
}

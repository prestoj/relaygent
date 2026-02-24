/** Shared utility functions for activity display */

export function shortName(n) {
	if (!n) return '?';
	if (!n.startsWith('mcp__')) return n;
	const parts = n.replace('mcp__', '').split('__');
	return `${parts[0]}.${(parts[1] || '').replace(`${parts[0]}_`, '')}`;
}

export function cat(n) {
	if (!n) return 'other';
	if (['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(n)) return 'file';
	if (n === 'Bash') return 'bash';
	if (n.startsWith('mcp__')) return 'mcp';
	return 'other';
}

export function relTime(now, ts) {
	const d = Math.floor((now - new Date(ts).getTime()) / 1000);
	if (d < 5) return 'now';
	if (d < 60) return `${d}s`;
	if (d < 3600) return `${Math.floor(d / 60)}m`;
	return `${Math.floor(d / 3600)}h`;
}

export function itemKey(item) {
	return item.toolUseId || `${item.time}-${item.name || item.type}`;
}

/** Utility functions for session detail page. */

export function itemKey(item, i) { return item.toolUseId || `${item.time}-${i}`; }

export function fmtTime(iso) {
	if (!iso) return '';
	try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
	catch { return ''; }
}

export function fmtTokens(n) {
	if (!n) return '0';
	if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n/1000).toFixed(0)}K`;
	return String(n);
}

/** Categorize tool name → file | bash | mcp | other */
export function toolCategory(n) {
	if (!n) return 'other';
	if (['Read','Edit','Write','Glob','Grep'].includes(n)) return 'file';
	if (n === 'Bash') return 'bash';
	if (n.startsWith('mcp__')) return 'mcp';
	return 'other';
}

/** Shorten MCP tool names: mcp__slack__send_message → slack.send_message */
export function shortName(n) {
	if (!n.startsWith('mcp__')) return n;
	const parts = n.replace('mcp__', '').split('__');
	return `${parts[0]}.${(parts[1] || '').replace(`${parts[0]}_`, '')}`;
}

export function fmtParams(params) {
	if (!params || !Object.keys(params).length) return '';
	return Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null)
		.map(([k, v]) => {
			const val = typeof v === 'string' ? v :
				Array.isArray(v) ? JSON.stringify(v, null, 2) : JSON.stringify(v);
			return `${k}: ${val}`;
		}).join('\n');
}

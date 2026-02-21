import { loadSession } from '$lib/relayActivity.js';

const SESSION_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/;

function fmtTokens(n) {
	if (!n) return '0';
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
	return String(n);
}

function fmtTime(iso) {
	if (!iso) return '';
	try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
	catch { return ''; }
}

function shortName(n) {
	if (!n?.startsWith('mcp__')) return n || '';
	const parts = n.replace('mcp__', '').split('__');
	return `${parts[0]}.${(parts[1] || '').replace(`${parts[0]}_`, '')}`;
}

/** GET /api/sessions/export?id=YYYY-MM-DD-HH-MM-SS */
export async function GET({ url }) {
	const id = url.searchParams.get('id');
	if (!id || !SESSION_ID_RE.test(id)) {
		return new Response('Invalid session ID', { status: 400 });
	}
	const result = loadSession(id);
	if (!result) return new Response('Session not found', { status: 404 });

	const st = result.stats || {};
	const act = result.activity || [];
	const displayTime = id.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/, '$1 $2:$3:$4');
	const lines = [];

	lines.push(`# Session ${displayTime}\n`);
	const statParts = [];
	if (st.durationMin != null) statParts.push(`**Duration:** ${st.durationMin}m`);
	if (st.turns) statParts.push(`**Turns:** ${st.turns}`);
	if (st.toolCalls) statParts.push(`**Tool calls:** ${st.toolCalls}`);
	if (st.totalTokens) statParts.push(`**Tokens in:** ${fmtTokens(st.totalTokens)}`);
	if (st.outputTokens) statParts.push(`**Tokens out:** ${fmtTokens(st.outputTokens)}`);
	if (statParts.length) lines.push(statParts.join(' · ') + '\n');

	if (st.handoffGoal) lines.push(`> **Goal:** ${st.handoffGoal}\n`);

	const topTools = Object.entries(st.tools || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
	if (topTools.length) {
		lines.push('## Top Tools\n');
		lines.push('| Tool | Count |\n|------|-------|');
		for (const [name, count] of topTools) lines.push(`| ${name} | ${count} |`);
		lines.push('');
	}

	lines.push('## Activity\n');
	for (const item of act) {
		const time = fmtTime(item.time);
		if (item.type === 'text') {
			const text = item.text?.length > 500 ? item.text.slice(0, 500) + '...' : item.text;
			lines.push(`**${time}** 💬 ${text}\n`);
		} else if (item.type === 'tool') {
			const name = item.name?.startsWith('mcp__') ? shortName(item.name) : item.name;
			const input = item.input ? ` — ${item.input.length > 100 ? item.input.slice(0, 100) + '...' : item.input}` : '';
			lines.push(`**${time}** \`${name}\`${input}\n`);
		}
	}

	const md = lines.join('\n');
	const filename = `session-${id}.md`;
	return new Response(md, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
		},
	});
}

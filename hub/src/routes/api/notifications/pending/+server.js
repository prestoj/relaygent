import { json } from '@sveltejs/kit';

const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const NOTIF_URL = `http://127.0.0.1:${NOTIF_PORT}`;

/** GET /api/notifications/pending — fetch pending notifications from all sources */
export async function GET({ url }) {
	const fast = url.searchParams.get('fast') === '1';
	const qs = fast ? '?fast=1' : '';
	try {
		const res = await fetch(`${NOTIF_URL}/notifications/pending${qs}`, { signal: AbortSignal.timeout(15000) });
		const data = await res.json();
		const items = (Array.isArray(data) ? data : []).map(n => ({
			type: n.type,
			source: n.source || n.type,
			count: n.count || 1,
			summary: formatSummary(n),
			time: extractTime(n),
		})).filter(n => n.summary);
		return json({ notifications: items });
	} catch {
		return json({ notifications: [], error: 'Notifications service unreachable' });
	}
}

function formatSummary(n) {
	if (n.type === 'reminder') return n.message || 'Reminder';
	if (n.type === 'task') return `${n.description || 'Task'}${n.overdue ? ` (${n.overdue})` : ''}`;
	if (n.source === 'slack' && n.channels?.length) {
		return n.channels.map(c => `#${c.name}: ${c.unread} unread`).join(', ');
	}
	if (n.source === 'email' && n.previews?.length) {
		return n.previews.map(e => e.subject || e.from).join(', ');
	}
	if (n.messages?.length) return n.messages[0].content || '';
	if (n.count) return `${n.count} new ${n.source || n.type} notification(s)`;
	return '';
}

function extractTime(n) {
	if (n.trigger_time) return n.trigger_time;
	if (n.messages?.[0]?.timestamp) return n.messages[0].timestamp;
	return null;
}

/** Shared utilities for ChatBubble */
import { marked } from 'marked';
import { sanitizeHtml } from '$lib/sanitize.js';

export function renderMsg(m) {
	if (m.role === 'assistant') return sanitizeHtml(marked.parse(m.content || ''));
	return (m.content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function fmtTime(iso) {
	return new Date(iso.endsWith('Z') ? iso : iso + 'Z')
		.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function isRelayMsg(m) {
	return m.role === 'assistant' && /^\[relay\]/.test(m.content || '');
}

/** Group consecutive relay messages into collapsible batches */
export function groupMessages(messages) {
	const groups = [];
	let batch = [];
	for (const m of messages) {
		if (isRelayMsg(m)) { batch.push(m); }
		else {
			if (batch.length) { groups.push({ relay: true, msgs: batch }); batch = []; }
			groups.push({ relay: false, msg: m });
		}
	}
	if (batch.length) groups.push({ relay: true, msgs: batch });
	return groups;
}

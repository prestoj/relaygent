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

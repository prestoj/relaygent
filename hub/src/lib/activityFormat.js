/** Short human-readable summary for the collapsed feed view. */
export function summarizeInput(toolName, input) {
	if (!input) return '';
	if (toolName === 'Bash') return input.command?.slice(0, 120) || '';
	if (toolName === 'Read') return input.file_path?.replace(process.env.HOME, '~') || '';
	if (toolName === 'Edit' || toolName === 'Write') return input.file_path?.replace(process.env.HOME, '~') || '';
	if (toolName === 'Grep') return `/${input.pattern}/${input.path ? ' in ' + input.path.split('/').pop() : ''}`;
	if (toolName === 'Glob') return input.pattern || '';
	if (toolName === 'TodoWrite') return input.todos?.find(t => t.status === 'in_progress')?.content || '';
	if (toolName === 'WebFetch') return input.url?.replace(/^https?:\/\//, '').slice(0, 60) || '';
	if (toolName === 'WebSearch') return input.query || '';
	if (toolName === 'Task') return input.description || '';
	if (toolName.startsWith('mcp__wake-triggers__')) return input.message?.slice(0, 40) || '';
	if (toolName.startsWith('mcp__')) {
		const firstVal = Object.values(input || {})[0];
		return typeof firstVal === 'string' ? firstVal.slice(0, 60) : '';
	}
	return '';
}

/** Extract full text from a tool result (for expanded view). */
export function extractResultText(content) {
	if (!content) return '';
	if (typeof content === 'string') return content.replace(/^\s+\d+→/gm, '').trim();
	if (Array.isArray(content)) {
		const texts = content.filter(c => c.type === 'text').map(c => c.text);
		const hasImage = content.some(c => c.type === 'image');
		let full = texts.join('\n').trim();
		if (hasImage) full = (full ? full + '\n' : '') + '[image]';
		return full;
	}
	return '';
}

/** Short summary of a tool result for collapsed view. */
export function summarizeResult(content) {
	const full = extractResultText(content);
	if (full.length <= 80) return full;
	return full.slice(0, 80) + '…';
}

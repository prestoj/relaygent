/**
 * Session JSONL parser — extracts tool activity and text from relay session lines.
 *
 * Usage:
 *   const parser = createSessionParser({ onResult, summarizeInput, summarizeResult, extractResultText });
 *   const activities = parser.parseLine(jsonlLine);
 */

const MAX_PENDING = 200;

/**
 * Create a session parser with injected dependencies.
 * @param {Object} deps
 * @param {Function} deps.onResult - called with { toolUseId, result, fullResult } when a tool result matches
 * @param {Function} deps.summarizeInput - (toolName, input) => string
 * @param {Function} deps.summarizeResult - (content) => string
 * @param {Function} deps.extractResultText - (content) => string
 */
export function createSessionParser({ onResult, summarizeInput, summarizeResult, extractResultText }) {
	const pendingTools = new Map();

	function parseLine(line) {
		try {
			const entry = JSON.parse(line);
			if (entry.type === 'assistant' && entry.message?.content) {
				const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
				const activities = [];
				for (const item of items) {
					if (item?.type === 'tool_use') {
						const act = {
							type: 'tool', name: item.name, time: entry.timestamp,
							input: summarizeInput(item.name, item.input), params: item.input || {},
							result: '', toolUseId: item.id,
						};
						pendingTools.set(item.id, act);
						if (pendingTools.size > MAX_PENDING) pendingTools.delete(pendingTools.keys().next().value);
						activities.push(act);
					} else if (item?.type === 'text' && item.text?.length > 10) {
						activities.push({ type: 'text', time: entry.timestamp, text: item.text });
					}
				}
				return activities;
			}
			if (entry.type === 'user' && entry.message?.content) {
				const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
				for (const item of items) {
					if (item?.type === 'tool_result' && pendingTools.has(item.tool_use_id)) {
						const result = summarizeResult(item.content);
						const fullResult = extractResultText(item.content);
						if (result || fullResult) onResult({ toolUseId: item.tool_use_id, result, fullResult });
						pendingTools.delete(item.tool_use_id);
					}
				}
			}
		} catch (e) { if (!(e instanceof SyntaxError)) console.error('parseLine:', e.message); }
		return [];
	}

	function clear() { pendingTools.clear(); }

	return { parseLine, clear, pendingTools };
}

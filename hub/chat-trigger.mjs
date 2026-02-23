/**
 * Chat trigger file watcher — broadcasts new chat messages via WebSocket.
 * Watches TRIGGER_FILE for changes and broadcasts parsed JSON to all clients.
 */
import fs from 'fs';
import path from 'path';

const TRIGGER_FILE = process.env.HUB_CHAT_TRIGGER_FILE || '/tmp/hub-chat-new.json';

export function watchChatTrigger(broadcast) {
	let lastTrigger = '';
	function handleChange() {
		try {
			const raw = fs.readFileSync(TRIGGER_FILE, 'utf-8');
			if (raw === lastTrigger) return;
			lastTrigger = raw;
			broadcast({ type: 'message', data: JSON.parse(raw) });
		} catch { /* mid-write or missing */ }
	}
	try {
		fs.watch(path.dirname(TRIGGER_FILE), (event, filename) => {
			if (filename === path.basename(TRIGGER_FILE)) handleChange();
		});
	} catch {
		setInterval(handleChange, 500);
	}
}

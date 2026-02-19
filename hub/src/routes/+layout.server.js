import { getUnreadHumanMessages } from '$lib/chat.js';
import { loadTasks } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';

export function load() {
	let unreadChat = 0, dueTasks = 0;
	try { unreadChat = getUnreadHumanMessages().length; } catch { /* ignore */ }
	try { dueTasks = loadTasks(getKbDir()).tasks.filter(t => t.due).length; } catch { /* ignore */ }
	return { unreadChat, dueTasks };
}

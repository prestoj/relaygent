import { loadTasks } from '$lib/tasks.js';
import { getKbDir, findDeadLinks } from '$lib/kb.js';

const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';

export async function load() {
	let dueTasks = 0, deadKbLinks = 0, dueReminders = 0;
	try { dueTasks = loadTasks(getKbDir()).tasks.filter(t => t.due).length; } catch { /* ignore */ }
	try { deadKbLinks = findDeadLinks().length; } catch { /* ignore */ }
	try {
		const res = await fetch(`http://127.0.0.1:${NOTIF_PORT}/pending`,
			{ signal: AbortSignal.timeout(1000) });
		const reminders = await res.json();
		dueReminders = Array.isArray(reminders) ? reminders.length : 0;
	} catch { /* ignore */ }
	return { dueTasks, deadKbLinks, dueReminders };
}

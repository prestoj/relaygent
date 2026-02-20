import { loadTasks } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';

const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';

async function loadReminders() {
	try {
		const res = await fetch(`http://127.0.0.1:${NOTIF_PORT}/upcoming`);
		return await res.json();
	} catch {
		return [];
	}
}

export async function load() {
	const kbDir = getKbDir();
	const { tasks } = loadTasks(kbDir);
	const now = new Date();

	const recurring = tasks
		.filter(t => t.type === 'recurring')
		.sort((a, b) => {
			if (a.due !== b.due) return a.due ? -1 : 1;
			const ta = a.nextDue ? new Date(a.nextDue).getTime() : Infinity;
			const tb = b.nextDue ? new Date(b.nextDue).getTime() : Infinity;
			return ta - tb;
		});

	const oneoff = tasks.filter(t => t.type !== 'recurring');
	const reminders = await loadReminders();

	return { recurring, oneoff, reminders, now: now.toISOString() };
}

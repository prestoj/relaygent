import { loadTasks } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';

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

	return { recurring, oneoff, now: now.toISOString() };
}

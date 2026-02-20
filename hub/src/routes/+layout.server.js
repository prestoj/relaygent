import { loadTasks } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';

export function load() {
	let dueTasks = 0;
	try { dueTasks = loadTasks(getKbDir()).tasks.filter(t => t.due).length; } catch { /* ignore */ }
	return { dueTasks };
}

import { loadTasks } from '$lib/tasks.js';
import { getKbDir, findDeadLinks } from '$lib/kb.js';
import { isAuthEnabled } from '$lib/auth.js';


export async function load() {
	let dueTasks = 0, deadKbLinks = 0;
	try { dueTasks = loadTasks(getKbDir()).tasks.filter(t => t.due).length; } catch { /* ignore */ }
	try { deadKbLinks = findDeadLinks().length; } catch { /* ignore */ }
	return { dueTasks, deadKbLinks, authEnabled: isAuthEnabled() };
}

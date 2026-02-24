import os from 'os';
import { loadTasks } from '$lib/tasks.js';
import { getKbDir } from '$lib/kb.js';
import { isAuthEnabled } from '$lib/auth.js';

export async function load() {
	let dueTasks = 0;
	try { dueTasks = loadTasks(getKbDir()).tasks.filter(t => t.due).length; } catch { /* ignore */ }
	return { dueTasks, authEnabled: isAuthEnabled(), hostname: os.hostname() };
}

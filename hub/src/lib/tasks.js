/**
 * Tasks KB parsing and mutation for the hub.
 * Reads/writes ~/knowledge/topics/tasks.md.
 */
import fs from 'fs';
import path from 'path';

const FREQ_HOURS = { '6h': 6, '12h': 12, 'daily': 24, '2d': 48, '3d': 72, 'weekly': 168, 'monthly': 720 };

function freqToMs(freq) { return (FREQ_HOURS[freq] || 24) * 3600000; }

function parseTaskLine(line) {
	const m = line.match(/^-\s+\[([x ])\]\s+(.+)$/i);
	if (!m) return null;
	const checked = m[1].toLowerCase() === 'x';
	const parts = m[2].split('|').map(s => s.trim());
	const description = parts[0].trim();
	const meta = {};
	for (const p of parts.slice(1)) {
		const kv = p.match(/^(\w+):\s*(.+)$/);
		if (kv) meta[kv[1]] = kv[2].trim();
	}
	return { checked, description, type: meta.type || 'one-off', freq: meta.freq || '', last: meta.last || '' };
}

function getNextDue(task) {
	if (task.type !== 'recurring' || !task.freq) return null;
	if (!task.last || task.last === 'never') return new Date(0);
	const ms = new Date(task.last).getTime();
	return isNaN(ms) ? new Date(0) : new Date(ms + freqToMs(task.freq));
}

export function loadTasks(kbDir) {
	const file = path.join(kbDir, 'tasks.md');
	try {
		const raw = fs.readFileSync(file, 'utf-8');
		const now = new Date();
		const tasks = [];
		for (const line of raw.split('\n')) {
			const t = parseTaskLine(line);
			if (!t) continue;
			const next = getNextDue(t);
			const due = next ? next <= now : false;
			const minsLate = (next && due) ? Math.round((now - next) / 60000) : null;
			tasks.push({ ...t, nextDue: next?.toISOString() || null, due, minsLate });
		}
		return { tasks, file };
	} catch { return { tasks: [], file }; }
}

export function addTask(kbDir, description) {
	const file = path.join(kbDir, 'tasks.md');
	try {
		let raw = fs.readFileSync(file, 'utf-8');
		const newLine = `- [ ] ${description} | type: one-off`;
		const today = new Date().toISOString().slice(0, 10);
		// Insert under ## One-off section if it exists, else ## Tasks, else append
		if (/^## One-off/m.test(raw)) {
			raw = raw.replace(/^(## One-off\n(?:\(none\)\n)?)/m, `$1${newLine}\n`);
			raw = raw.replace(/\(none\)\n/, '');
		} else if (/^## Tasks/m.test(raw)) {
			raw = raw.replace(/^(## Tasks\n)/m, `$1${newLine}\n`);
		} else {
			raw += `\n${newLine}\n`;
		}
		raw = raw.replace(/^updated:.*$/m, `updated: ${today}`);
		const tmp = file + '.tmp'; fs.writeFileSync(tmp, raw, 'utf-8'); fs.renameSync(tmp, file);
		return true;
	} catch { return false; }
}

export function removeTask(kbDir, description) {
	const file = path.join(kbDir, 'tasks.md');
	try {
		let raw = fs.readFileSync(file, 'utf-8');
		const today = new Date().toISOString().slice(0, 10);
		const lines = raw.split('\n').filter(l => {
			const t = parseTaskLine(l);
			return !(t && t.description === description && t.type !== 'recurring');
		});
		raw = lines.join('\n').replace(/^updated:.*$/m, `updated: ${today}`);
		const tmp = file + '.tmp'; fs.writeFileSync(tmp, raw, 'utf-8'); fs.renameSync(tmp, file);
		return true;
	} catch { return false; }
}

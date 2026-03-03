import { json, error } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.env.HOME, '.relaygent', 'config.json');
function getRepoDir() {
	try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).paths?.repo; } catch { /* ignore */ }
	return path.join(process.env.HOME, 'relaygent');
}
const REPO_DIR = getRepoDir();
const LOGS_DIR = process.env.RELAYGENT_LOGS_DIR || path.join(REPO_DIR, 'logs');
const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data');

const STATIC_SOURCES = [
	{ id: 'relaygent', label: 'Relay' },
	{ id: 'relaygent-hub', label: 'Hub' },
	{ id: 'relaygent-notifications', label: 'Notifications' },
	{ id: 'slack-socket', label: 'Slack Socket' },
];

function getBgSources() {
	try {
		const tasks = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'background-tasks.json'), 'utf8'));
		return tasks.filter(t => t.log && t.pid).map(t => {
			let alive = false;
			try { process.kill(t.pid, 0); alive = true; } catch {}
			const shortDesc = t.desc.length > 35 ? t.desc.slice(0, 35) + '…' : t.desc;
			return { id: `bg:${t.pid}`, label: `${alive ? '●' : '○'} ${shortDesc}`, logPath: t.log, bg: true };
		});
	} catch { return []; }
}

function tailFile(filePath, lines) {
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return null;
		const readSize = Math.min(stat.size, 512 * 1024);
		const buf = Buffer.alloc(readSize);
		const fd = fs.openSync(filePath, 'r');
		try { fs.readSync(fd, buf, 0, readSize, stat.size - readSize); } finally { fs.closeSync(fd); }
		const text = buf.toString('utf-8');
		const all = text.split('\n');
		const trimmed = readSize < stat.size ? all.slice(1) : all;
		return trimmed.slice(-lines).join('\n');
	} catch { return null; }
}

/** GET /api/logs?file=relaygent&lines=200  or  ?sources=true */
export async function GET({ url }) {
	if (url.searchParams.get('sources') === 'true') {
		return json({ sources: [...STATIC_SOURCES, ...getBgSources()] });
	}

	const file = url.searchParams.get('file') || 'relaygent';
	const lines = Math.min(parseInt(url.searchParams.get('lines') || '200', 10), 1000);

	let filePath;
	if (file.startsWith('bg:')) {
		const source = getBgSources().find(s => s.id === file);
		if (!source) throw error(400, 'Unknown background task');
		filePath = source.logPath;
	} else {
		if (!STATIC_SOURCES.some(s => s.id === file)) throw error(400, 'Unknown log file');
		filePath = path.join(LOGS_DIR, `${file}.log`);
	}

	const content = tailFile(filePath, lines);
	if (content === null) return json({ file, lines: '', error: 'File not found or unreadable' });
	return json({ file, lines: content });
}

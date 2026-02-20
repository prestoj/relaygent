import { json, error } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.env.HOME, 'projects', 'relaygent', 'logs');

// Whitelist of log files exposed to the hub
const ALLOWED = ['relaygent', 'relaygent-hub', 'relaygent-notifications', 'slack-socket'];

function tailFile(filePath, lines) {
	try {
		const stat = fs.statSync(filePath);
		// Read up to 512KB from the end to find last N lines
		const readSize = Math.min(stat.size, 512 * 1024);
		const buf = Buffer.alloc(readSize);
		const fd = fs.openSync(filePath, 'r');
		try { fs.readSync(fd, buf, 0, readSize, stat.size - readSize); } finally { fs.closeSync(fd); }
		const text = buf.toString('utf-8');
		const all = text.split('\n');
		// If we didn't read from the start, first line may be partial — drop it
		const trimmed = readSize < stat.size ? all.slice(1) : all;
		return trimmed.slice(-lines).join('\n');
	} catch {
		return null;
	}
}

/** GET /api/logs?file=relaygent&lines=200 */
export async function GET({ url }) {
	const file = url.searchParams.get('file') || 'relaygent';
	const lines = Math.min(parseInt(url.searchParams.get('lines') || '200', 10), 1000);

	if (!ALLOWED.includes(file)) {
		throw error(400, 'Unknown log file');
	}

	const filePath = path.join(LOGS_DIR, `${file}.log`);
	const content = tailFile(filePath, lines);

	if (content === null) {
		return json({ file, lines: '', error: 'File not found or unreadable' });
	}

	return json({ file, lines: content });
}

import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.env.HOME, 'projects', 'relaygent', 'logs');
const DEFAULT_FILE = 'relaygent';
const DEFAULT_LINES = 200;

function tailFile(filePath, lines) {
	try {
		const stat = fs.statSync(filePath);
		const readSize = Math.min(stat.size, 512 * 1024);
		const buf = Buffer.alloc(readSize);
		const fd = fs.openSync(filePath, 'r');
		try { fs.readSync(fd, buf, 0, readSize, stat.size - readSize); } finally { fs.closeSync(fd); }
		const text = buf.toString('utf-8');
		const all = text.split('\n');
		const trimmed = readSize < stat.size ? all.slice(1) : all;
		return trimmed.slice(-lines).join('\n');
	} catch { return ''; }
}

export async function load() {
	const filePath = path.join(LOGS_DIR, `${DEFAULT_FILE}.log`);
	return { initialLines: tailFile(filePath, DEFAULT_LINES) };
}

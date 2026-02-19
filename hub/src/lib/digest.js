import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { sanitizeHtml } from './sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_DIR = path.resolve(process.cwd()).endsWith('hub')
	? process.cwd()
	: path.join(__dirname, '..', '..');
const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(HUB_DIR, '..', 'data');
const DIGEST_DIR = path.join(DATA_DIR, 'digests');

/** Validate date slug resolves within DIGEST_DIR */
function safeDatePath(date) {
	const filepath = path.join(DIGEST_DIR, `${date}.md`);
	const resolved = path.resolve(filepath);
	if (!resolved.startsWith(path.resolve(DIGEST_DIR))) throw new Error('Invalid date');
	return filepath;
}

/** List all digest dates, newest first */
export function listDigests() {
	try {
		return fs.readdirSync(DIGEST_DIR)
			.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
			.map(f => f.replace(/\.md$/, ''))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/** Load and render a single digest by date (YYYY-MM-DD) */
export function getDigest(date) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date format');
	const filepath = safeDatePath(date);
	const raw = fs.readFileSync(filepath, 'utf-8');
	const html = sanitizeHtml(marked.parse(raw));
	return { date, html };
}

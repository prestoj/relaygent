import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { redirect } from '@sveltejs/kit';
import { isAuthEnabled, validateSession, COOKIE_NAME } from '$lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, '..', '..');
const HITS_FILE = path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'page_hits.json');

const PUBLIC_PATHS = ['/login', '/api/health', '/favicon.svg'];

function recordHit(pathname) {
	const date = new Date().toISOString().split('T')[0];
	let data = {};
	try { data = JSON.parse(fs.readFileSync(HITS_FILE, 'utf-8')); } catch {}
	if (!data[date]) data[date] = {};
	data[date][pathname] = (data[date][pathname] || 0) + 1;
	try {
		fs.mkdirSync(path.dirname(HITS_FILE), { recursive: true });
		fs.writeFileSync(HITS_FILE, JSON.stringify(data, null, 2));
	} catch { /* ignore */ }
}

function isLocalhost(addr) {
	return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export async function handle({ event, resolve }) {
	const { pathname } = event.url;

	// Auth check — skip for localhost, public paths, static assets, and when auth is disabled
	if (isAuthEnabled() && !pathname.startsWith('/_') && !pathname.includes('.')) {
		const isLocal = isLocalhost(event.getClientAddress());
		const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
		if (!isPublic && !isLocal) {
			const token = event.cookies.get(COOKIE_NAME);
			if (!validateSession(token)) {
				if (pathname.startsWith('/api/')) {
					return new Response(JSON.stringify({ error: 'Unauthorized' }), {
						status: 401, headers: { 'Content-Type': 'application/json' },
					});
				}
				throw redirect(302, '/login');
			}
		}
	}

	if (!pathname.startsWith('/_') && !pathname.includes('.')) recordHit(pathname);
	return resolve(event);
}

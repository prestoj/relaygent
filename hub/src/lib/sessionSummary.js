import { execFile } from 'child_process';
import { findLatestSession, parseSession } from './relayActivity.js';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(process.env.HOME, 'projects', 'relaygent', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'session-summaries');

/** Compact activity into a prompt-friendly string (tool names + text, no full results). */
export function compactActivity(activity, maxItems = 40) {
	const recent = activity.slice(-maxItems);
	const lines = [];
	for (const item of recent) {
		if (item.type === 'text') {
			lines.push(`[thought] ${item.text.slice(0, 150)}`);
		} else if (item.type === 'tool') {
			const inp = item.input ? ` ${item.input.slice(0, 100)}` : '';
			const res = item.result ? ` → ${item.result.slice(0, 80)}` : '';
			lines.push(`[${item.name}]${inp}${res}`);
		}
	}
	return lines.join('\n').slice(0, 6000);
}

/** Run claude CLI with haiku to summarize text. Returns the summary string. */
function callHaiku(prompt) {
	return new Promise((resolve, reject) => {
		const child = execFile('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001'], {
			timeout: 30000,
			maxBuffer: 1024 * 64,
			env: { ...process.env, DISABLE_INTERACTIVITY: '1' },
		}, (err, stdout) => {
			if (err) return reject(err);
			resolve(stdout.trim());
		});
	});
}

/** Summarize the current live session. No caching — always fresh. */
export async function summarizeCurrent() {
	const sessionFile = findLatestSession();
	if (!sessionFile) return null;
	const activity = parseSession(sessionFile, 100);
	if (activity.length < 3) return null;
	const compact = compactActivity(activity);
	const prompt = `You are summarizing what an AI agent is currently working on. Based on its recent tool calls and thoughts, write a 2-3 sentence summary of what it's doing right now. Be specific and concrete. No preamble.\n\nRecent activity:\n${compact}`;
	return callHaiku(prompt);
}

/** Summarize a completed session by ID. Caches result. */
export async function summarizeSession(sessionId, activity) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	const cacheFile = path.join(CACHE_DIR, `${sessionId}.txt`);
	try {
		const cached = fs.readFileSync(cacheFile, 'utf-8').trim();
		if (cached) return cached;
	} catch { /* not cached */ }

	if (!activity || activity.length < 3) return null;
	const compact = compactActivity(activity, 80);
	const prompt = `Summarize what this AI agent accomplished in this session in 3-5 sentences. Be specific about what was built, fixed, or changed. No preamble.\n\nSession activity:\n${compact}`;
	const summary = await callHaiku(prompt);

	try { fs.writeFileSync(cacheFile, summary); } catch { /* ignore */ }
	return summary;
}

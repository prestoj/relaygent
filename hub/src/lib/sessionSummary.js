import { execFile, execFileSync } from 'child_process';
import { findLatestSession, parseSession } from './relayActivity.js';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.RELAYGENT_DATA_DIR || path.join(process.env.HOME, 'projects', 'relaygent', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'session-summaries');

/** Resolve the claude CLI binary — checks env var, known locations, then PATH. */
function findClaudeBin() {
	if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
	const candidates = [
		path.join(process.env.HOME || '', '.local/bin/claude'),
		'/usr/local/bin/claude',
		'/opt/homebrew/bin/claude',
	];
	for (const c of candidates) {
		try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* skip */ }
	}
	try { return execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim(); } catch { /* not in PATH */ }
	return 'claude';
}
const CLAUDE_BIN = findClaudeBin();

/** Build a clean env for subprocess — strips CLAUDECODE to avoid nested-session error. */
function cleanEnv() {
	const env = { ...process.env, DISABLE_INTERACTIVITY: '1' };
	delete env.CLAUDECODE;
	return env;
}

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
		const child = execFile(CLAUDE_BIN, ['-p', '-', '--model', 'claude-haiku-4-5-20251001'], {
			timeout: 30000,
			maxBuffer: 1024 * 64,
			env: cleanEnv(),
		}, (err, stdout) => {
			if (err) return reject(err);
			resolve(stdout.trim());
		});
		child.stdin.write(prompt);
		child.stdin.end();
	});
}

/** Summarize the current live session. No caching — always fresh. */
export async function summarizeCurrent() {
	const sessionFile = findLatestSession();
	if (!sessionFile) return null;
	const activity = parseSession(sessionFile, 100);
	if (activity.length < 3) return null;
	const compact = compactActivity(activity);
	const prompt = `You are summarizing what an AI agent is currently working on. Based on its recent tool calls and thoughts, write a concise markdown summary. Use this format:

**Currently:** One sentence about what the agent is doing right now.

- Bullet point with a specific recent action or change
- Another specific action (2-4 bullets total)

Be specific and concrete. No preamble or extra commentary.

Recent activity:\n${compact}`;
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
	const prompt = `Summarize what this AI agent accomplished in this session using markdown. Use this format:

**Summary:** One sentence overview of the session.

### Key accomplishments
- Specific thing that was built, fixed, or changed
- Another accomplishment (3-6 bullets total)

### Details
1-2 sentences of additional context if needed.

Be specific and concrete. No preamble or extra commentary.

Session activity:\n${compact}`;
	const summary = await callHaiku(prompt);

	try { fs.writeFileSync(cacheFile, summary); } catch { /* ignore */ }
	return summary;
}

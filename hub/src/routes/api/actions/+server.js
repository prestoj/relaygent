import { json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BIN = process.env.RELAYGENT_BIN || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'bin', 'relaygent');

const ACTIONS = {
	health: ['health'],
	check: ['check'],
	status: ['status'],
	digest: ['digest'],
	'clean-logs': ['clean-logs', '--dry-run'],
	restart: ['restart'],
};

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }

/** POST /api/actions — run a whitelisted relaygent command */
export async function POST({ request }) {
	const { action } = await request.json();
	if (!ACTIONS[action]) return json({ error: `Unknown action: ${action}` }, { status: 400 });
	const start = Date.now();
	try {
		const { stdout, stderr } = await exec(BIN, ACTIONS[action], {
			timeout: 30000,
			env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
		});
		return json({ output: stripAnsi(stdout + (stderr || '')), ms: Date.now() - start });
	} catch (e) {
		const output = stripAnsi((e.stdout || '') + (e.stderr || ''));
		return json({ output, exitCode: e.code || 1, ms: Date.now() - start });
	}
}

/** GET /api/actions — list available actions */
export function GET() {
	return json({ actions: Object.keys(ACTIONS) });
}

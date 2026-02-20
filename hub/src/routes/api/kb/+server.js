import { json } from '@sveltejs/kit';
import { execFile } from 'child_process';
import { getKbDir } from '$lib/kb.js';
import { completeTask } from '$lib/tasks.js';
import path from 'path';
import fs from 'fs';

export async function POST() {
	const kbDir = getKbDir();
	const commitScript = path.join(path.dirname(kbDir), 'commit.sh');
	if (!fs.existsSync(commitScript)) {
		return json({ ok: false, error: 'commit.sh not found' }, { status: 404 });
	}
	return new Promise(resolve => {
		execFile('bash', [commitScript], { timeout: 10000 }, (err, stdout, stderr) => {
			if (err) {
				resolve(json({ ok: false, error: stderr || err.message }, { status: 500 }));
				return;
			}
			try { completeTask(kbDir, 'Commit KB changes \u2014 run ~/knowledge/commit.sh'); } catch { /* ignore */ }
			resolve(json({ ok: true }));
		});
	});
}

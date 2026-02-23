import { json } from '@sveltejs/kit';
import fs from 'fs';
import os from 'os';

const CONFIG_PATH = `${os.homedir()}/.relaygent/config.json`;

/** GET /api/vnc — return VNC config (password for auto-auth) */
export function GET() {
	try {
		const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
		const vnc = config.vnc || {};
		return json({ password: vnc.password || null, port: vnc.port || 5900 });
	} catch {
		return json({ password: null, port: 5900 });
	}
}

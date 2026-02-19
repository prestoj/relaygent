/**
 * Service health checks for the dashboard.
 * Quick HTTP pings with short timeouts — non-blocking.
 * Only checks services that are part of the Relaygent stack.
 */
import fs from 'fs';
import path from 'path';

const NOTIFICATIONS_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const HS_PORT = process.env.HAMMERSPOON_PORT || '8097';
const STATUS_FILE = path.join(
	process.env.RELAYGENT_DATA_DIR || path.join(process.env.HOME, 'relaygent', 'data'),
	'relay-status.json'
);

const SERVICES = [
	{ name: 'Notifications', url: `http://127.0.0.1:${NOTIFICATIONS_PORT}/health` },
	{ name: 'Computer Use', url: `http://127.0.0.1:${HS_PORT}/health` },
];

async function checkService(svc) {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2000);
		const res = await fetch(svc.url, { signal: controller.signal });
		clearTimeout(timeout);
		const ok = res.ok;
		let detail = '';
		if (ok && svc.key) {
			try {
				const data = await res.json();
				detail = data[svc.key] || '';
			} catch { /* ignore */ }
		}
		return { name: svc.name, ok, detail };
	} catch {
		return { name: svc.name, ok: false, detail: '' };
	}
}

function checkRelayStatus() {
	try {
		const { status } = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
		return { name: 'Relay', ok: status === 'working' || status === 'sleeping', detail: status };
	} catch {
		return { name: 'Relay', ok: false, detail: 'off' };
	}
}

export async function getServiceHealth() {
	const results = await Promise.all(SERVICES.map(checkService));
	return [checkRelayStatus(), ...results];
}

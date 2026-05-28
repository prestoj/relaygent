import { json } from '@sveltejs/kit';
import { writeFileSync } from 'node:fs';

const NOTIF_URL = `http://127.0.0.1:${process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083'}`;
const RETIRE_MARKER = '/tmp/relaygent-retire.json';

const WRAP_MESSAGE =
	'User requested wrap-up via hub. Write your HANDOFF.md (MAIN GOAL for next Claude, ' +
	'what you did, open threads), update MEMORY.md if needed, commit KB changes, then ' +
	'finish your turn. A fresh successor session will spawn.';

/** POST /api/relay/retire — write retire marker + fire wake-up notification */
export async function POST() {
	try {
		writeFileSync(RETIRE_MARKER, JSON.stringify({ ts: Date.now(), source: 'hub-ui' }));
	} catch (e) {
		return json({ error: `Failed to write retire marker: ${String(e)}` }, { status: 500 });
	}

	try {
		const r = await fetch(`${NOTIF_URL}/reminder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				trigger_time: new Date().toISOString(),
				message: WRAP_MESSAGE,
			}),
		});
		if (!r.ok) {
			return json({
				ok: true,
				warning: `Marker written but notification failed: HTTP ${r.status}`,
			});
		}
	} catch (e) {
		return json({
			ok: true,
			warning: `Marker written but notification request failed: ${String(e)}`,
		});
	}

	return json({ ok: true, marker: RETIRE_MARKER });
}

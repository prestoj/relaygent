import { json } from '@sveltejs/kit';

const NOTIF_URL = `http://127.0.0.1:${process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083'}`;

const WRAP_MESSAGE =
	'User requested wrap-up via hub. Write your HANDOFF.md (MAIN GOAL for next Claude, ' +
	'what you did, open threads), update MEMORY.md if needed, commit KB changes, then ' +
	'call the `mcp__relaygent-notifications__retire` tool to spawn a fresh successor.';

/** Local-naive ISO (no Z): notifications service compares trigger_time as a
 *  naive string; sending UTC-with-Z would never lex-compare ≤ local now. */
function localIsoNow() {
	const d = new Date();
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
		.toISOString().replace('Z', '');
}

/** POST /api/relay/retire — fire a reminder telling Claude to wrap up.
 *  The relay's normal notification path delivers it (waking if asleep,
 *  injecting if mid-loop). Claude voluntarily writes the handoff + calls
 *  the `retire` MCP tool to spawn the successor. */
export async function POST() {
	try {
		const r = await fetch(`${NOTIF_URL}/reminder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ trigger_time: localIsoNow(), message: WRAP_MESSAGE }),
		});
		if (!r.ok) return json({ error: `Notification failed: HTTP ${r.status}` }, { status: 502 });
	} catch (e) {
		return json({ error: `Notification request failed: ${String(e)}` }, { status: 502 });
	}
	return json({ ok: true });
}

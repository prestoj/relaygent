const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';

export async function load() {
	let reminders = [];
	try {
		const res = await fetch(`http://127.0.0.1:${NOTIF_PORT}/upcoming`,
			{ signal: AbortSignal.timeout(2000) });
		reminders = await res.json();
	} catch { /* notifications service unreachable */ }
	return { reminders };
}

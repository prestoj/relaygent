// Unread message checking — socket cache + API fallback
import { readFileSync, existsSync } from "fs";
import { slackApi } from "./slack-client.mjs";
import { userName, formatText, formatTs, dmName } from "./slack-helpers.mjs";

const SOCKET_CACHE = "/tmp/relaygent-slack-socket-cache.json";

export async function checkUnread(lastAckPath) {
	if (existsSync(SOCKET_CACHE)) {
		let ackTs = 0;
		try { ackTs = parseFloat(readFileSync(lastAckPath, "utf-8").trim()) || 0; } catch {}
		const sock = JSON.parse(readFileSync(SOCKET_CACHE, "utf-8"));
		const msgs = (sock.messages || []).filter(m => parseFloat(m.ts || "0") > ackTs);
		if (msgs.length > 0) {
			const lines = await Promise.all(msgs.map(async m => {
				const user = await userName(m.user);
				const ch = m.channel_name || m.channel || "?";
				const cid = m.channel ? ` (${m.channel})` : "";
				return `[${formatTs(m.ts)}] [#${ch}${cid}] <${user}> ${await formatText(m.text)}`;
			}));
			return lines.join("\n");
		}
		return null;
	}
	// Fallback: check via API
	const data = await slackApi("conversations.list", {
		limit: 100, types: "public_channel,private_channel,mpim,im", exclude_archived: true,
	});
	const chs = (data.channels || []).slice(0, 15);
	if (!chs.length) return null;
	const unread = (await Promise.all(chs.map(async c => {
		try {
			const info = await slackApi("conversations.info", { channel: c.id });
			if (info.channel.unread_count_display > 0)
				return `${await dmName(info.channel)}: ${info.channel.unread_count_display} unread`;
		} catch {}
		return null;
	}))).filter(Boolean);
	return unread.length ? unread.join("\n") : null;
}

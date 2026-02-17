/**
 * Shared helpers for Slack MCP tools.
 * User name resolution and DM channel name formatting.
 */
import { slackApi } from "./slack-client.mjs";

// User ID → display name cache
const userCache = new Map();

export async function userName(uid) {
	if (!uid || !uid.startsWith("U")) return uid || "unknown";
	if (userCache.has(uid)) return userCache.get(uid);
	try {
		const d = await slackApi("users.info", { user: uid });
		const name = d.user?.real_name || d.user?.name || uid;
		userCache.set(uid, name);
		return name;
	} catch { userCache.set(uid, uid); return uid; }
}

// Resolve DM channel to partner's display name
export async function dmName(ch) {
	if (ch.is_im && ch.user) return `DM: ${await userName(ch.user)}`;
	if (ch.is_mpim) return `Group DM: ${ch.name}`;
	return `#${ch.name}`;
}

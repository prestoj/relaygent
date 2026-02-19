import { getUnreadHumanMessages } from '$lib/chat.js';

export function load() {
	try {
		return { unreadChat: getUnreadHumanMessages().length };
	} catch { return { unreadChat: 0 }; }
}

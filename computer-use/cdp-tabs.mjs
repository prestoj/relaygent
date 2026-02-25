// CDP tab management — switch tabs and sync to visible tab
import { cdpActivate, cdpHttp, cdpDisconnect, getConnection, saveTabId, resetWs } from "./cdp.mjs";

function log(msg) { process.stderr.write(`[cdp-tabs] ${msg}\n`); }

export async function cdpSwitchTab(tabId) {
	const ok = await cdpActivate(tabId); if (!ok) return false;
	resetWs(); saveTabId(tabId);
	await getConnection();
	return true;
}

export async function cdpNewTab(url) {
	const tab = await cdpHttp(`/json/new?${url}`);
	if (!tab || !tab.id) return false;
	resetWs(); saveTabId(tab.id);
	await cdpActivate(tab.id);
	await getConnection();
	return true;
}

export async function cdpSyncToVisibleTab(url) {
	cdpDisconnect();
	const urlBase = url.replace(/\/$/, "").replace(/^https?:\/\//, "");
	for (let attempt = 0; attempt < 5; attempt++) {
		await new Promise(r => setTimeout(r, 600));
		const tabs = await cdpHttp("/json/list");
		if (!tabs) continue;
		const pages = tabs.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
		const target = pages.find(t => t.url === url)
			?? pages.find(t => t.url.replace(/^https?:\/\//, "").startsWith(urlBase))
			?? (attempt >= 2 ? pages.find(t => /^https?:/.test(t.url) && t.url !== "about:blank") ?? pages[0] : null);
		if (target) {
			saveTabId(target.id);
			await cdpActivate(target.id);
			await getConnection();
			log(`synced to tab: ${target.url.substring(0, 60)}`);
			return;
		}
	}
	log(`sync failed: could not find tab for ${url.substring(0, 60)}`);
}

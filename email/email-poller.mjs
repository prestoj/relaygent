#!/usr/bin/env node
/**
 * Gmail email poller — checks for new emails every 2 minutes.
 * Posts to hub chat when new emails arrive, waking the agent.
 *
 * Reads credentials from ~/.relaygent/gmail/ (same as email MCP).
 * Tracks last-check timestamp in ~/.relaygent/gmail/.last_check_ts.
 *
 * Usage: node email-poller.mjs
 * Env: HUB_PORT (default 8080), HOME
 */
import { getGmailClient } from "./gmail-client.mjs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

function gmailDir() { return join(homedir(), ".relaygent", "gmail"); }
function lastCheckFile() { return join(gmailDir(), ".last_check_ts"); }
function hubChat() { return `http://127.0.0.1:${process.env.HUB_PORT || "8080"}/api/chat`; }

export function log(msg) {
	const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
	console.log(`[${ts}] [email-poller] ${msg}`);
}

export function getLastTs() {
	try {
		if (existsSync(lastCheckFile())) return parseFloat(readFileSync(lastCheckFile(), "utf-8").trim()) || 0;
	} catch {}
	return 0;
}

export function saveTs(ts) {
	try { mkdirSync(gmailDir(), { recursive: true }); writeFileSync(lastCheckFile(), String(ts)); } catch {}
}

export async function postToHub(content) {
	try {
		const res = await fetch(hubChat(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content, role: "user" }),
		});
		if (!res.ok) log(`Hub post failed: HTTP ${res.status}`);
	} catch (e) { log(`Hub post error: ${e.message}`); }
}

export async function poll(gmailOverride = null) {
	let gmail;
	try { gmail = gmailOverride || getGmailClient(); } catch (e) {
		log(`Gmail not configured: ${e.message}`); return;
	}

	const lastTs = getLastTs();
	const now = Math.floor(Date.now() / 1000);
	const after = lastTs ? Math.floor(lastTs) : now - 300; // 5 min window on first run

	try {
		const res = await gmail.users.messages.list({
			userId: "me", q: `is:unread after:${after}`, maxResults: 10,
		});
		const messages = res.data.messages || [];
		saveTs(now);
		if (!messages.length) return;

		const previews = [];
		for (const m of messages.slice(0, 5)) {
			try {
				const d = await gmail.users.messages.get({
					userId: "me", id: m.id, format: "metadata",
					metadataHeaders: ["From", "Subject"],
				});
				const h = d.data.payload?.headers || [];
				const from = h.find(x => x.name === "From")?.value || "?";
				const subject = h.find(x => x.name === "Subject")?.value || "(no subject)";
				previews.push(`  From: ${from}\n  Subject: ${subject}`);
			} catch {}
		}

		const count = messages.length;
		const extra = count > 5 ? `\n  (+${count - 5} more)` : "";
		log(`${count} new email(s) — notifying`);
		await postToHub(`[Email] ${count} new email(s) at agent-two@relaygent.ai:\n${previews.join("\n")}${extra}`);
	} catch (e) { log(`Poll error: ${e.message}`); }
}

// Auto-start only when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const POLL_MS = 2 * 60 * 1000;
	log(`Started — polling every ${POLL_MS / 60000} min (hub port ${process.env.HUB_PORT || "8080"})`);
	poll();
	setInterval(poll, POLL_MS);
}

#!/usr/bin/env node
/**
 * Gmail email poller — checks for new emails every 2 minutes.
 * Writes non-automated emails to a cache file read by the notifications service.
 * Skips bulk/automated mail (newsletters, digests, notification emails).
 *
 * Reads credentials from ~/.relaygent/gmail/ (same as email MCP).
 * Tracks last-check timestamp in ~/.relaygent/gmail/.last_check_ts.
 * Cache: RELAYGENT_EMAIL_CACHE env var or /tmp/relaygent-email-cache.json
 *
 * Usage: node email-poller.mjs
 */
import { getGmailClient } from "./gmail-client.mjs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

function gmailDir() { return join(homedir(), ".relaygent", "gmail"); }
function lastCheckFile() { return join(gmailDir(), ".last_check_ts"); }
export function cacheFile() { return process.env.RELAYGENT_EMAIL_CACHE || "/tmp/relaygent-email-cache.json"; }

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

export function writeEmailCache(emails) {
	try {
		let existing = [];
		if (existsSync(cacheFile())) {
			try { existing = JSON.parse(readFileSync(cacheFile(), "utf-8")).emails || []; } catch {}
		}
		const data = { last_updated: Date.now() / 1000, emails: [...emails, ...existing].slice(0, 50) };
		writeFileSync(cacheFile(), JSON.stringify(data));
	} catch (e) { log(`Cache write error: ${e.message}`); }
}

const AUTOMATED_HEADERS = ["auto-submitted", "list-unsubscribe", "x-autoreply"];
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

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

		const emails = [];
		for (const m of messages) {
			try {
				const d = await gmail.users.messages.get({
					userId: "me", id: m.id, format: "metadata",
					metadataHeaders: ["From", "Subject", "Auto-Submitted", "List-Unsubscribe", "Precedence", "X-Autoreply"],
				});
				const hs = d.data.payload?.headers || [];
				const hmap = Object.fromEntries(hs.map(x => [x.name.toLowerCase(), x.value || ""]));
				if (AUTOMATED_HEADERS.some(h => hmap[h]) || BULK_PRECEDENCE.has((hmap["precedence"] || "").toLowerCase())) continue;
				emails.push({ from: hmap["from"] || "?", subject: hmap["subject"] || "(no subject)", received_at: now });
			} catch {}
		}

		if (!emails.length) return;
		log(`${emails.length} new email(s) — writing to cache`);
		writeEmailCache(emails);
	} catch (e) { log(`Poll error: ${e.message}`); }
}

// Auto-start only when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const POLL_MS = 2 * 60 * 1000;
	log(`Started — polling every ${POLL_MS / 60000} min`);
	poll();
	setInterval(poll, POLL_MS);
}

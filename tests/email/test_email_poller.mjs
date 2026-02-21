/**
 * Unit tests for email-poller.mjs
 *
 * Uses dependency injection (poll(mockGmail)) — no mock.module() needed.
 * Uses RELAYGENT_EMAIL_CACHE env var to isolate cache file per test.
 * Sets process.env.HOME per-test to isolate filesystem state.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { getLastTs, saveTs, cacheFile, writeEmailCache, poll } from "../../email/email-poller.mjs";

let tmpHome, tmpCache;
beforeEach(() => {
	tmpHome = mkdtempSync(join(tmpdir(), "email-test-"));
	tmpCache = join(tmpHome, "email-cache.json");
	process.env.HOME = tmpHome;
	process.env.RELAYGENT_EMAIL_CACHE = tmpCache;
});
afterEach(() => {
	try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
	delete process.env.RELAYGENT_EMAIL_CACHE;
});

// Helper: build a fake Gmail client with optional header sets per message id
function fakeGmail({ messages = [], headers = {} } = {}) {
	return {
		users: {
			messages: {
				list: async () => ({ data: { messages } }),
				get: async ({ id }) => ({
					data: { payload: { headers: headers[id] || [] } },
				}),
			},
		},
	};
}

function h(pairs) { return Object.entries(pairs).map(([name, value]) => ({ name, value })); }

// --- Timestamp helpers ---
test("getLastTs returns 0 when file absent", () => {
	assert.equal(getLastTs(), 0);
});

test("saveTs + getLastTs round-trip", () => {
	saveTs(1234567890.5);
	assert.ok(Math.abs(getLastTs() - 1234567890.5) < 0.1);
});

test("saveTs creates missing directory", () => {
	saveTs(42);
	const f = join(tmpHome, ".relaygent", "gmail", ".last_check_ts");
	assert.ok(existsSync(f));
	assert.equal(readFileSync(f, "utf-8").trim(), "42");
});

// --- cacheFile ---
test("cacheFile respects RELAYGENT_EMAIL_CACHE env var", () => {
	assert.equal(cacheFile(), tmpCache);
});

// --- writeEmailCache ---
test("writeEmailCache creates cache file with emails", () => {
	const emails = [{ from: "a@b.com", subject: "Hi", received_at: 100 }];
	writeEmailCache(emails);
	const data = JSON.parse(readFileSync(cacheFile(), "utf-8"));
	assert.equal(data.emails.length, 1);
	assert.equal(data.emails[0].from, "a@b.com");
});

test("writeEmailCache merges with existing entries", () => {
	writeEmailCache([{ from: "a@b.com", subject: "First", received_at: 100 }]);
	writeEmailCache([{ from: "c@d.com", subject: "Second", received_at: 200 }]);
	const data = JSON.parse(readFileSync(cacheFile(), "utf-8"));
	assert.equal(data.emails.length, 2);
	assert.equal(data.emails[0].from, "c@d.com"); // newest first
});

test("writeEmailCache caps at 50 entries", () => {
	const initial = Array.from({ length: 48 }, (_, i) => ({ from: "x", subject: `e${i}`, received_at: i }));
	writeEmailCache(initial);
	writeEmailCache([{ from: "a", subject: "new1", received_at: 100 }, { from: "b", subject: "new2", received_at: 101 }, { from: "c", subject: "new3", received_at: 102 }]);
	const data = JSON.parse(readFileSync(cacheFile(), "utf-8"));
	assert.equal(data.emails.length, 50);
});

// --- poll ---
test("poll does nothing when Gmail list throws", async () => {
	const broken = { users: { messages: { list: async () => { throw new Error("no creds"); } } } };
	await poll(broken);
	assert.ok(!existsSync(cacheFile()));
});

test("poll does nothing when no new messages", async () => {
	await poll(fakeGmail({ messages: [] }));
	assert.ok(!existsSync(cacheFile()));
});

test("poll writes cache with from and subject", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }, { id: "m2" }],
		headers: {
			m1: h({ From: "Alice <a@x.com>", Subject: "Hi" }),
			m2: h({ From: "Bob <b@x.com>", Subject: "Yo" }),
		},
	});
	await poll(gmail);
	const data = JSON.parse(readFileSync(cacheFile(), "utf-8"));
	assert.equal(data.emails.length, 2);
	assert.ok(data.emails.some(e => e.from.includes("Alice") && e.subject === "Hi"));
	assert.ok(data.emails.some(e => e.from.includes("Bob") && e.subject === "Yo"));
});

test("poll saves timestamp after each run", async () => {
	const before = Math.floor(Date.now() / 1000) - 1;
	await poll(fakeGmail());
	assert.ok(getLastTs() >= before);
});

test("poll skips automated emails (Auto-Submitted header)", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }],
		headers: { m1: h({ From: "slack@example.com", Subject: "Digest", "Auto-Submitted": "auto-generated" }) },
	});
	await poll(gmail);
	assert.ok(!existsSync(cacheFile()));
});

test("poll skips bulk emails (Precedence: bulk)", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }],
		headers: { m1: h({ From: "news@example.com", Subject: "Newsletter", Precedence: "bulk" }) },
	});
	await poll(gmail);
	assert.ok(!existsSync(cacheFile()));
});

test("poll skips emails with List-Unsubscribe header", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }],
		headers: { m1: h({ From: "promo@example.com", Subject: "Sale!", "List-Unsubscribe": "<mailto:unsub@example.com>" }) },
	});
	await poll(gmail);
	assert.ok(!existsSync(cacheFile()));
});

test("poll keeps real emails alongside automated ones", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }, { id: "m2" }],
		headers: {
			m1: h({ From: "alice@example.com", Subject: "Meeting tomorrow" }),
			m2: h({ From: "slack@slack.com", Subject: "You have unread", "Auto-Submitted": "auto-generated" }),
		},
	});
	await poll(gmail);
	const data = JSON.parse(readFileSync(cacheFile(), "utf-8"));
	assert.equal(data.emails.length, 1);
	assert.equal(data.emails[0].subject, "Meeting tomorrow");
});

test("poll handles missing headers gracefully", async () => {
	const gmail = fakeGmail({ messages: [{ id: "m1" }], headers: { m1: [] } });
	await poll(gmail);
	const data = JSON.parse(readFileSync(cacheFile(), "utf-8"));
	assert.equal(data.emails[0].subject, "(no subject)");
	assert.equal(data.emails[0].from, "?");
});

test("poll with null gmailOverride falls back to real client (no-creds path)", async () => {
	await assert.doesNotReject(() => poll(null));
	assert.ok(!existsSync(cacheFile()));
});

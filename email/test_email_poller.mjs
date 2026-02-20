/**
 * Unit tests for email-poller.mjs
 *
 * Uses dependency injection (poll(mockGmail)) — no mock.module() needed.
 * Uses a fake HTTP server to capture hub chat POSTs.
 * Sets process.env.HOME per-test to isolate filesystem state.
 */
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { getLastTs, saveTs, postToHub, poll } from "./email-poller.mjs";

// --- Fake hub chat server ---
let hubServer;
const hubCalls = [];

before(async () => {
	await new Promise((resolve) => {
		hubServer = http.createServer((req, res) => {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				try { hubCalls.push(JSON.parse(body)); } catch {}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ id: 1 }));
			});
		});
		hubServer.listen(0, "127.0.0.1", () => resolve());
	});
	process.env.HUB_PORT = String(hubServer.address().port);
});

after(() => hubServer?.close());

let tmpHome;
beforeEach(() => {
	tmpHome = mkdtempSync(join(tmpdir(), "email-test-"));
	process.env.HOME = tmpHome;
	hubCalls.length = 0;
});
afterEach(() => {
	try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

// Helper: build a fake Gmail client
function fakeGmail({ messages = [], details = {} } = {}) {
	return {
		users: {
			messages: {
				list: async () => ({ data: { messages } }),
				get: async ({ id }) => ({ data: details[id] || { payload: { headers: [] } } }),
			},
		},
	};
}

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

// --- postToHub ---
test("postToHub sends POST with content and role:user", async () => {
	await postToHub("hello world");
	assert.equal(hubCalls.length, 1);
	assert.equal(hubCalls[0].content, "hello world");
	assert.equal(hubCalls[0].role, "user");
});

test("postToHub survives hub unreachable", async () => {
	const saved = process.env.HUB_PORT;
	process.env.HUB_PORT = "1";
	await assert.doesNotReject(() => postToHub("test"));
	process.env.HUB_PORT = saved;
});

// --- poll ---
test("poll does nothing when Gmail list throws", async () => {
	const broken = { users: { messages: { list: async () => { throw new Error("no creds"); } } } };
	await poll(broken);
	assert.equal(hubCalls.length, 0);
});

test("poll does nothing when no new messages", async () => {
	await poll(fakeGmail({ messages: [] }));
	assert.equal(hubCalls.length, 0);
});

test("poll notifies hub with sender and subject preview", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }, { id: "m2" }],
		details: {
			m1: { payload: { headers: [{ name: "From", value: "Alice <a@x.com>" }, { name: "Subject", value: "Hi" }] } },
			m2: { payload: { headers: [{ name: "From", value: "Bob <b@x.com>" }, { name: "Subject", value: "Yo" }] } },
		},
	});
	await poll(gmail);
	assert.equal(hubCalls.length, 1);
	const { content } = hubCalls[0];
	assert.ok(content.includes("[Email]"));
	assert.ok(content.includes("2 new email"));
	assert.ok(content.includes("Alice"));
	assert.ok(content.includes("Hi"));
	assert.ok(content.includes("Bob"));
});

test("poll saves timestamp after each run", async () => {
	const before = Math.floor(Date.now() / 1000) - 1;
	await poll(fakeGmail());
	assert.ok(getLastTs() >= before);
});

test("poll shows overflow count when >5 messages", async () => {
	const gmail = fakeGmail({ messages: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `m${i}` })) });
	await poll(gmail);
	assert.equal(hubCalls.length, 1);
	assert.ok(hubCalls[0].content.includes("+1 more"));
});

test("poll handles missing headers gracefully", async () => {
	const gmail = fakeGmail({
		messages: [{ id: "m1" }],
		details: { m1: { payload: { headers: [] } } },
	});
	await poll(gmail);
	assert.equal(hubCalls.length, 1);
	assert.ok(hubCalls[0].content.includes("(no subject)"));
});

test("poll with null gmailOverride falls back to real client (no-creds path)", async () => {
	// tmpHome has no Gmail credentials — getGmailClient should throw, poll should not throw
	await assert.doesNotReject(() => poll(null));
	assert.equal(hubCalls.length, 0);
});

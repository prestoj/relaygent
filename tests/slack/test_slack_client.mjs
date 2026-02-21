/**
 * Tests for slack-client.mjs — API calls, caching, rate limiting, token loading.
 * Spins up a fake HTTP server + sets HOME/SLACK_API_URL BEFORE importing
 * so module-level constants (BASE_URL, token path) use our test values.
 * Run: node --test tests/slack/test_slack_client.mjs
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Setup BEFORE import (env vars baked in at module load) ────────────────────
let handler = () => ({ ok: true });

const server = http.createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const params = Object.fromEntries(new URLSearchParams(body));
	const method = req.url.replace("/", "");
	const result = await handler(method, params, req);
	const json = typeof result === "string" ? result : JSON.stringify(result);
	const status = result._status || 200;
	const headers = { "Content-Type": "application/json", ...(result._headers || {}) };
	res.writeHead(status, headers);
	res.end(json);
});
await new Promise(r => server.listen(0, r));
const serverPort = server.address().port;

const tmpHome = mkdtempSync(join(tmpdir(), "slack-test-"));
const slackDir = join(tmpHome, ".relaygent", "slack");
mkdirSync(slackDir, { recursive: true });
writeFileSync(join(slackDir, "token.json"), JSON.stringify({ access_token: "xoxp-test-token" }));

process.env.HOME = tmpHome;
process.env.SLACK_API_URL = `http://127.0.0.1:${serverPort}`;

// Now import — BASE_URL and token path will use our test values
const { slackApi, getToken } = await import("../../slack/slack-client.mjs");

after(() => server.close());

describe("getToken", () => {
	it("loads token from HOME/.relaygent/slack/token.json", () => {
		assert.equal(getToken(), "xoxp-test-token");
	});
});

describe("slackApi", () => {
	it("sends POST with auth header and params", async () => {
		let captured;
		handler = (method, params, req) => {
			captured = { method, params, auth: req.headers.authorization };
			return { ok: true, result: "success" };
		};
		const res = await slackApi("chat.postMessage", { channel: "C123", text: "hi" });
		assert.equal(captured.method, "chat.postMessage");
		assert.equal(captured.params.channel, "C123");
		assert.equal(captured.params.text, "hi");
		assert.equal(captured.auth, "Bearer xoxp-test-token");
		assert.equal(res.result, "success");
	});

	it("throws on non-ok response", async () => {
		handler = () => ({ ok: false, error: "channel_not_found" });
		await assert.rejects(
			() => slackApi("chat.postMessage", { channel: "bad" }),
			/channel_not_found/
		);
	});

	it("caches read-only methods", async () => {
		let callCount = 0;
		handler = () => { callCount++; return { ok: true, user: { name: "alice" } }; };
		// Use unique params to avoid hitting cache from other tests
		await slackApi("users.info", { user: "UCACHE1" });
		await slackApi("users.info", { user: "UCACHE1" });
		assert.equal(callCount, 1, "second call should use cache");
	});

	it("does not cache write methods", async () => {
		let callCount = 0;
		handler = () => { callCount++; return { ok: true }; };
		await slackApi("chat.postMessage", { text: "a" });
		await slackApi("chat.postMessage", { text: "a" });
		assert.equal(callCount, 2, "write methods should not be cached");
	});

	it("retries on 429 rate limit", async () => {
		let callCount = 0;
		handler = () => {
			callCount++;
			if (callCount === 1) return { _status: 429, _headers: { "Retry-After": "0" }, ok: false };
			return { ok: true, retried: true };
		};
		const res = await slackApi("conversations.list", { _bust: Date.now().toString() });
		assert.equal(callCount, 2);
		assert.equal(res.retried, true);
	});
});

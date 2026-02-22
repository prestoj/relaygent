/**
 * Unit tests for browser-query.mjs tool handlers.
 *
 * Uses a fake Hammerspoon HTTP server and a fake CDP HTTP server (returns no
 * page targets) so all cdpEval calls return null and cdpConnected() is false.
 * This lets us test every tool's error/disconnected path without Chrome.
 *
 * Run: node --test tests/computer-use/test_browser_query.mjs
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";

// ── Tiny 1x1 red PNG (89 bytes) so takeScreenshot doesn't fail on file read ──
const SCREENSHOT = "/tmp/claude-screenshot.png";
const PNG_1x1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
	"base64",
);
writeFileSync(SCREENSHOT, PNG_1x1);

// ── Fake Hammerspoon backend ──────────────────────────────────────────────────
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", width: 1920, height: 1080, path: SCREENSHOT }));
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));

// ── Fake CDP HTTP server — returns empty tab list (no pages) ──────────────────
const cdpServer = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end("[]");
});
await new Promise((r) => cdpServer.listen(0, "127.0.0.1", r));

// ── Set env BEFORE importing modules (they read ports at load time) ───────────
process.env.HAMMERSPOON_PORT = String(hsServer.address().port);
process.env.RELAYGENT_CDP_PORT = String(cdpServer.address().port);

// ── Import and capture tool handlers via mock server ──────────────────────────
const handlers = {};
const mockServer = { tool: (name, _desc, _schema, handler) => { handlers[name] = handler; } };
const { registerBrowserQueryTools } = await import("../../computer-use/browser-query.mjs");
registerBrowserQueryTools(mockServer);

after(() => { hsServer.close(); cdpServer.close(); try { unlinkSync(SCREENSHOT); } catch {} });

function jsonContent(result) { return JSON.parse(result.content[0].text); }

// ── Tool registration ─────────────────────────────────────────────────────────
describe("browser-query tool registration", () => {
	const EXPECTED = ["browser_eval", "browser_coords", "browser_wait", "browser_get_text", "browser_url"];

	it("registers all 5 query tools", () => {
		for (const name of EXPECTED) assert.ok(handlers[name], `missing: ${name}`);
		assert.equal(Object.keys(handlers).length, EXPECTED.length);
	});
});

// ── browser_eval ──────────────────────────────────────────────────────────────
describe("browser_eval", () => {
	it("returns null result when CDP has no pages", async () => {
		const r = await handlers.browser_eval({ expression: "1+1" });
		assert.equal(jsonContent(r).result, null);
	});
});

// ── browser_coords ────────────────────────────────────────────────────────────
describe("browser_coords", () => {
	it("returns error when CDP disconnected", async () => {
		const r = await handlers.browser_coords({ selector: "#btn" });
		const data = jsonContent(r);
		assert.ok(data.error);
		assert.ok(data.error.includes("CDP not connected"));
	});
});

// ── browser_wait ──────────────────────────────────────────────────────────────
describe("browser_wait", () => {
	it("returns timeout when CDP disconnected", async () => {
		const r = await handlers.browser_wait({ selector: "#el", timeout: 100 });
		const data = jsonContent(r);
		assert.equal(data.status, "timeout");
		assert.equal(data.selector, "#el");
	});
});

// ── browser_get_text ──────────────────────────────────────────────────────────
describe("browser_get_text", () => {
	it("returns CDP error when disconnected (no selector)", async () => {
		const r = await handlers.browser_get_text({});
		const data = jsonContent(r);
		assert.ok(data.error);
		assert.ok(data.error.includes("CDP not connected"));
	});

	it("returns CDP error with selector in message", async () => {
		const r = await handlers.browser_get_text({ selector: "#content" });
		const data = jsonContent(r);
		assert.ok(data.error);
	});
});

// ── browser_url ───────────────────────────────────────────────────────────────
describe("browser_url", () => {
	it("returns CDP error when disconnected", async () => {
		const r = await handlers.browser_url({});
		const data = jsonContent(r);
		assert.ok(data.error);
		assert.ok(data.error.includes("CDP not connected"));
	});
});

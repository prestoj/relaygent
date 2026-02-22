/**
 * Unit tests for browser-nav.mjs (tab switching and closing).
 *
 * Uses fake Hammerspoon + CDP servers. CDP returns empty tab list so
 * cdpSwitchTab/cdpCloseTab fail predictably — tests error paths.
 *
 * Run: node --test tests/computer-use/test_browser_nav.mjs
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";

// ── Tiny 1x1 PNG so takeScreenshot doesn't fail on file read ──
const SCREENSHOT = "/tmp/claude-screenshot.png";
const PNG_1x1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
	"base64",
);
writeFileSync(SCREENSHOT, PNG_1x1);

// ── Fake Hammerspoon backend ──
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", width: 1920, height: 1080, path: SCREENSHOT }));
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));

// ── Fake CDP HTTP server — /json/list returns empty, /json/activate returns 404 ──
const cdpServer = http.createServer((req, res) => {
	if (req.url.startsWith("/json/activate/")) {
		res.writeHead(404); res.end();
	} else if (req.url.startsWith("/json/close/")) {
		res.writeHead(404); res.end();
	} else {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end("[]");
	}
});
await new Promise((r) => cdpServer.listen(0, "127.0.0.1", r));

// ── Set env BEFORE importing modules ──
process.env.HAMMERSPOON_PORT = String(hsServer.address().port);
process.env.RELAYGENT_CDP_PORT = String(cdpServer.address().port);

// ── Import and register tools via mock server ──
const handlers = {};
const mockServer = { tool: (name, _desc, _schema, handler) => { handlers[name] = handler; } };
const { registerBrowserNavTools } = await import("../../computer-use/browser-nav.mjs");
registerBrowserNavTools(mockServer);

after(() => { hsServer.close(); cdpServer.close(); try { unlinkSync(SCREENSHOT); } catch {} });

function jsonContent(result) { return JSON.parse(result.content[0].text); }

// ── Tool registration ──
describe("browser-nav tool registration", () => {
	it("registers browser_switch_tab, browser_close_tab, and browser_tabs", () => {
		assert.ok(handlers.browser_switch_tab, "missing browser_switch_tab");
		assert.ok(handlers.browser_close_tab, "missing browser_close_tab");
		assert.ok(handlers.browser_tabs, "missing browser_tabs");
		assert.equal(Object.keys(handlers).length, 3);
	});
});

// ── browser_tabs ──
describe("browser_tabs", () => {
	it("returns empty tab list from fake CDP", async () => {
		const r = await handlers.browser_tabs({});
		const j = jsonContent(r);
		assert.ok(Array.isArray(j.tabs));
		assert.equal(j.count, 0);
	});
});

// ── browser_switch_tab ──
describe("browser_switch_tab", () => {
	it("returns error when tab ID is invalid", async () => {
		const r = await handlers.browser_switch_tab({ id: "nonexistent-tab-id" });
		const j = jsonContent(r);
		assert.ok(j.error);
		assert.match(j.error, /not found|failed/i);
	});
});

// ── browser_close_tab ──
describe("browser_close_tab", () => {
	it("refuses to close when only one tab (or none)", async () => {
		const r = await handlers.browser_close_tab({ id: "some-tab-id" });
		const j = jsonContent(r);
		assert.ok(j.error);
		assert.match(j.error, /last tab|failed/i);
	});
});

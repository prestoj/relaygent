/**
 * Unit tests for browser-files.mjs (file upload tool).
 *
 * Uses fake Hammerspoon + CDP servers. CDP returns empty tab list so
 * cdpConnected() is false — tests the disconnected error path.
 *
 * Run: node --test tests/computer-use/test_browser_files.mjs
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

// ── Fake CDP HTTP server — returns empty tab list ──
const cdpServer = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end("[]");
});
await new Promise((r) => cdpServer.listen(0, "127.0.0.1", r));

// ── Set env BEFORE importing modules ──
process.env.HAMMERSPOON_PORT = String(hsServer.address().port);
process.env.RELAYGENT_CDP_PORT = String(cdpServer.address().port);

// ── Import and register tools via mock server ──
const handlers = {};
const mockServer = { tool: (name, _desc, _schema, handler) => { handlers[name] = handler; } };
const { registerBrowserFileTools } = await import("../../computer-use/browser-files.mjs");
registerBrowserFileTools(mockServer);

after(() => { hsServer.close(); cdpServer.close(); try { unlinkSync(SCREENSHOT); } catch {} });

function jsonContent(result) { return JSON.parse(result.content[0].text); }

// ── Tool registration ──
describe("browser-files tool registration", () => {
	it("registers browser_upload", () => {
		assert.ok(handlers.browser_upload, "missing browser_upload");
		assert.equal(Object.keys(handlers).length, 1);
	});
});

// ── browser_upload ──
describe("browser_upload", () => {
	it("returns CDP error when disconnected", async () => {
		const r = await handlers.browser_upload({
			selector: "input[type=file]",
			files: ["/tmp/test.txt"],
		});
		const j = jsonContent(r);
		assert.ok(j.error);
		assert.ok(j.error.includes("CDP not connected"));
	});
});

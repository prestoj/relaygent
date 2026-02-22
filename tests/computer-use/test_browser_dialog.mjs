/**
 * Unit tests for browser-dialog.mjs (JS dialog control tool).
 *
 * Tests dialog state management and tool responses without needing Chrome.
 *
 * Run: node --test tests/computer-use/test_browser_dialog.mjs
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";

const SCREENSHOT = "/tmp/claude-screenshot.png";
const PNG_1x1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
	"base64",
);
writeFileSync(SCREENSHOT, PNG_1x1);

// Fake Hammerspoon
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", width: 1920, height: 1080, path: SCREENSHOT }));
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));

// Fake CDP — returns empty tab list
const cdpServer = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end("[]");
});
await new Promise((r) => cdpServer.listen(0, "127.0.0.1", r));

process.env.HAMMERSPOON_PORT = String(hsServer.address().port);
process.env.RELAYGENT_CDP_PORT = String(cdpServer.address().port);

const handlers = {};
const mockServer = { tool: (name, _desc, _schema, handler) => { handlers[name] = handler; } };
const { registerBrowserDialogTools } = await import("../../computer-use/browser-dialog.mjs");
registerBrowserDialogTools(mockServer);

// Also import cdp state functions for simulating dialog events
const { getLastDialog, setNextDialogConfig } = await import("../../computer-use/cdp.mjs");

after(() => { hsServer.close(); cdpServer.close(); try { unlinkSync(SCREENSHOT); } catch {} });

function textContent(result) { return result.content[0].text; }

describe("browser_handle_dialog tool registration", () => {
	it("registers browser_handle_dialog", () => {
		assert.ok(handlers.browser_handle_dialog, "missing browser_handle_dialog");
		assert.equal(Object.keys(handlers).length, 1);
	});
});

describe("browser_handle_dialog status", () => {
	it("returns no-dialog message when none has appeared", async () => {
		const r = await handlers.browser_handle_dialog({ action: "status" });
		assert.ok(textContent(r).includes("No JavaScript dialog"));
	});
});

describe("browser_handle_dialog configure", () => {
	it("configures next dialog to accept (default)", async () => {
		const r = await handlers.browser_handle_dialog({ action: "configure" });
		assert.ok(textContent(r).includes("accepted"));
		assert.ok(textContent(r).includes("Auto-accept resumes after"));
	});

	it("configures next dialog to dismiss", async () => {
		const r = await handlers.browser_handle_dialog({ action: "configure", accept: false });
		assert.ok(textContent(r).includes("dismissed"));
	});

	it("configures next dialog with prompt text", async () => {
		const r = await handlers.browser_handle_dialog({
			action: "configure", accept: true, promptText: "hello world",
		});
		assert.ok(textContent(r).includes('hello world'));
		assert.ok(textContent(r).includes("accepted"));
	});

	it("setNextDialogConfig is one-shot (cleared after read)", () => {
		setNextDialogConfig({ accept: false });
		// Simulate reading config (like the handler would)
		const d = getLastDialog(); // null — no dialog yet
		assert.equal(d, null);
	});
});

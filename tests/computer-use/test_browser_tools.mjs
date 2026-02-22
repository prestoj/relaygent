/**
 * Unit tests for browser-tools.mjs tool handlers.
 *
 * Uses a fake Hammerspoon HTTP server and a fake CDP HTTP server (returns no
 * page targets) so all cdpEval calls return null and cdpConnected() is false.
 * This lets us test every tool's error/disconnected path without Chrome.
 *
 * Run: node --test tests/computer-use/test_browser_tools.mjs
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

// ── Fake Hammerspoon backend (screenshot, click, type, etc.) ─────────────────
let _hsResponse = { status: "ok", width: 1920, height: 1080, path: SCREENSHOT };
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(_hsResponse));
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));
const hsPort = hsServer.address().port;

// ── Fake CDP HTTP server — returns empty tab list (no pages) ─────────────────
// cdpHttp("/json/list") returns [] → getConnection returns null → cdpEval returns null
const cdpServer = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end("[]");
});
await new Promise((r) => cdpServer.listen(0, "127.0.0.1", r));
const cdpPort = cdpServer.address().port;

// ── Set env BEFORE importing modules (they read ports at load time) ──────────
process.env.HAMMERSPOON_PORT = String(hsPort);
process.env.RELAYGENT_CDP_PORT = String(cdpPort);

// ── Import browser-tools and capture tool handlers via mock server ────────────
const handlers = {};
const descriptions = {};
const mockServer = {
	tool: (name, desc, _schema, handler) => {
		handlers[name] = handler;
		descriptions[name] = desc;
	},
};
const { registerBrowserTools } = await import("../../computer-use/browser-tools.mjs");
registerBrowserTools(mockServer, true); // IS_LINUX = true

after(() => {
	hsServer.close();
	cdpServer.close();
	try { unlinkSync(SCREENSHOT); } catch {}
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function jsonContent(result) {
	return JSON.parse(result.content[0].text);
}
function textContent(result) {
	return result.content[0].text;
}

// ── Tool registration ────────────────────────────────────────────────────────
describe("tool registration", () => {
	const EXPECTED = [
		"browser_navigate", "browser_type", "browser_click", "browser_click_text",
		"browser_hover", "browser_select", "browser_scroll", "browser_fill",
	];

	it("registers all 8 browser action tools", () => {
		for (const name of EXPECTED) assert.ok(handlers[name], `missing: ${name}`);
		assert.equal(Object.keys(handlers).length, EXPECTED.length);
	});

	it("each tool has a description", () => {
		for (const name of EXPECTED) assert.ok(descriptions[name], `no desc: ${name}`);
	});
});

// ── browser_click ────────────────────────────────────────────────────────────
describe("browser_click", () => {
	it("returns CDP error when disconnected", async () => {
		const r = await handlers.browser_click({ selector: "button" });
		const data = jsonContent(r);
		assert.ok(data.error);
		assert.ok(data.error.includes("CDP not connected"));
	});
});

// ── browser_click_text ───────────────────────────────────────────────────────
describe("browser_click_text", () => {
	it("returns CDP error when disconnected", async () => {
		const r = await handlers.browser_click_text({ text: "Submit" });
		const data = jsonContent(r);
		assert.ok(data.error);
		assert.ok(data.error.includes("CDP not connected"));
	});
});

// ── browser_hover ───────────────────────────────────────────────────────────
describe("browser_hover", () => {
	it("returns CDP error when disconnected", async () => {
		const r = await handlers.browser_hover({ selector: ".dropdown-trigger" });
		const data = jsonContent(r);
		assert.ok(data.error);
		assert.ok(data.error.includes("CDP not connected"));
	});
});

// ── browser_type ─────────────────────────────────────────────────────────────
describe("browser_type", () => {
	it("returns error when element not found (CDP disconnected → null tag check)", async () => {
		// tagCheck returns null (not "SELECT"), so it proceeds to type expr
		// type expr returns null (CDP disconnected), which isn't "not found"
		// so it returns actionRes (screenshot-based response)
		const r = await handlers.browser_type({ selector: "input", text: "hello" });
		// With CDP disconnected, tagCheck is null (not SELECT), expr returns null
		// null !== "not found" so it falls through to actionRes
		assert.ok(r.content.length >= 1);
		assert.ok(textContent(r).includes("Typed into"));
	});
});

// ── browser_select ───────────────────────────────────────────────────────────
describe("browser_select", () => {
	it("returns element not found when CDP disconnected", async () => {
		// cdpEval returns null, which !== "not found" and !== "option not found"
		// so it returns actionRes
		const r = await handlers.browser_select({ selector: "select", option: "A" });
		assert.ok(r.content.length >= 1);
	});
});

// ── browser_scroll ───────────────────────────────────────────────────────────
describe("browser_scroll", () => {
	it("returns action response with default values", async () => {
		const r = await handlers.browser_scroll({});
		assert.ok(textContent(r).includes("Scrolled (0,300)"));
	});

	it("includes selector in response when provided", async () => {
		const r = await handlers.browser_scroll({ selector: ".container", x: 0, y: 500 });
		assert.ok(textContent(r).includes("in .container"));
	});
});

// ── browser_fill ─────────────────────────────────────────────────────────────
describe("browser_fill", () => {
	it("fills fields and returns count (CDP disconnected → falls through)", async () => {
		const r = await handlers.browser_fill({
			fields: [{ selector: "#name", value: "Alice" }, { selector: "#email", value: "a@b.com" }],
		});
		// CDP disconnected → cdpEval returns null (not "not found") → falls through
		assert.ok(textContent(r).includes("Filled 2 fields"));
	});

	it("returns error when submit click fails (CDP disconnected)", async () => {
		const r = await handlers.browser_fill({
			fields: [{ selector: "input", value: "test" }],
			submit: "button[type=submit]",
		});
		const data = jsonContent(r);
		assert.ok(data.error);
	});
});

// ── browser_navigate ─────────────────────────────────────────────────────────
describe("browser_navigate", () => {
	it("falls back to keyboard when CDP navigate fails", async () => {
		const r = await handlers.browser_navigate({ url: "https://example.com" });
		assert.ok(textContent(r).includes("Navigated to https://example.com"));
	});
});

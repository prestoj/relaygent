/**
 * Unit tests for clipboard-tools.mjs (clipboard read/write).
 *
 * Uses a fake Hammerspoon server that stores clipboard in memory.
 *
 * Run: node --test tests/computer-use/test_clipboard.mjs
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ── Fake Hammerspoon with in-memory clipboard ──
let fakeClipboard = "";
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		if (req.method === "GET" && req.url === "/clipboard") {
			res.end(JSON.stringify({ text: fakeClipboard }));
		} else if (req.method === "POST" && req.url === "/clipboard") {
			const params = JSON.parse(body || "{}");
			if (!params.text && params.text !== "") {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "text required" }));
				return;
			}
			fakeClipboard = params.text;
			res.end(JSON.stringify({ ok: true, length: fakeClipboard.length }));
		} else if (req.url === "/health") {
			res.end(JSON.stringify({ status: "ok" }));
		} else {
			res.end(JSON.stringify({ status: "ok" }));
		}
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));

// ── Set env BEFORE importing modules ──
process.env.HAMMERSPOON_PORT = String(hsServer.address().port);

// ── Import and register tools via mock server ──
const handlers = {};
const mockServer = { tool: (name, _desc, _schema, handler) => { handlers[name] = handler; } };
const { registerClipboardTools } = await import("../../computer-use/clipboard-tools.mjs");
registerClipboardTools(mockServer);

after(() => { hsServer.close(); });

function jsonContent(result) { return JSON.parse(result.content[0].text); }

describe("clipboard tool registration", () => {
	it("registers clipboard_read and clipboard_write", () => {
		assert.ok(handlers.clipboard_read, "missing clipboard_read");
		assert.ok(handlers.clipboard_write, "missing clipboard_write");
		assert.equal(Object.keys(handlers).length, 2);
	});
});

describe("clipboard_read", () => {
	it("reads empty clipboard", async () => {
		fakeClipboard = "";
		const r = await handlers.clipboard_read({});
		assert.equal(jsonContent(r).text, "");
	});

	it("reads clipboard with content", async () => {
		fakeClipboard = "hello world";
		const r = await handlers.clipboard_read({});
		assert.equal(jsonContent(r).text, "hello world");
	});
});

describe("clipboard_write", () => {
	it("writes text to clipboard", async () => {
		const r = await handlers.clipboard_write({ text: "test data" });
		const j = jsonContent(r);
		assert.equal(j.ok, true);
		assert.equal(j.length, 9);
		assert.equal(fakeClipboard, "test data");
	});

	it("round-trips through write then read", async () => {
		await handlers.clipboard_write({ text: "round trip test" });
		const r = await handlers.clipboard_read({});
		assert.equal(jsonContent(r).text, "round trip test");
	});
});

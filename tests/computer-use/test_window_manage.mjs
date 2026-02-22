/**
 * Unit tests for window_manage tool (native-tools.mjs).
 *
 * Uses a fake Hammerspoon server that simulates window operations.
 *
 * Run: node --test tests/computer-use/test_window_manage.mjs
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

// ── Fake Hammerspoon with window management ──
let lastAction = null;
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		if (req.url === "/window_manage") {
			const params = JSON.parse(body || "{}");
			lastAction = params;
			if (!params.action) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "action required" }));
				return;
			}
			if (params.action === "resize" && (!params.w || !params.h)) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "w and h required for resize" }));
				return;
			}
			res.end(JSON.stringify({ ok: true, action: params.action, app: "TestApp",
				frame: { x: 0, y: 0, w: 1280, h: 720 } }));
		} else {
			res.end(JSON.stringify({ status: "ok", width: 1920, height: 1080, path: SCREENSHOT }));
		}
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));

process.env.HAMMERSPOON_PORT = String(hsServer.address().port);

const handlers = {};
const mockServer = { tool: (name, _desc, _schema, handler) => { handlers[name] = handler; } };
const { registerNativeTools } = await import("../../computer-use/native-tools.mjs");
registerNativeTools(mockServer);

after(() => { hsServer.close(); try { unlinkSync(SCREENSHOT); } catch {} });

function jsonContent(result) { return JSON.parse(result.content[0].text); }

describe("window_manage registration", () => {
	it("registers window_manage tool", () => {
		assert.ok(handlers.window_manage, "missing window_manage");
	});
});

describe("window_manage maximize", () => {
	it("maximizes focused window", async () => {
		const r = await handlers.window_manage({ action: "maximize" });
		// actionRes returns screenshot, first content is text
		assert.ok(r.content[0].text.includes("maximize"));
	});

	it("maximizes by app name", async () => {
		await handlers.window_manage({ action: "maximize", app: "Chrome" });
		assert.equal(lastAction.app, "Chrome");
		assert.equal(lastAction.action, "maximize");
	});
});

describe("window_manage resize", () => {
	it("resizes window with w and h", async () => {
		await handlers.window_manage({ action: "resize", w: 800, h: 600 });
		assert.equal(lastAction.w, 800);
		assert.equal(lastAction.h, 600);
	});
});

describe("window_manage move", () => {
	it("moves window to position", async () => {
		await handlers.window_manage({ action: "move", x: 100, y: 50 });
		assert.equal(lastAction.x, 100);
		assert.equal(lastAction.y, 50);
	});
});

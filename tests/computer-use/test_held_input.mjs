/**
 * Unit tests for held input tools: key_down, key_up, mouse_down, mouse_up, release_all.
 * Uses a fake Hammerspoon backend to verify correct HTTP calls.
 *
 * Run: node --test tests/computer-use/test_held_input.mjs
 */

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync } from "node:fs";

const SCREENSHOT = "/tmp/claude-screenshot.png";
const PNG_1x1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
	"base64",
);
writeFileSync(SCREENSHOT, PNG_1x1);

// ── Fake Hammerspoon backend ────────────────────────────────────────────────
const requests = [];
let _response = { status: "ok", width: 1280, height: 720, path: SCREENSHOT };

const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		const parsed = body ? JSON.parse(body) : {};
		requests.push({ path: req.url, method: req.method, body: parsed });
		// Return specific responses for held input endpoints
		let resp = _response;
		if (req.url === "/key_down") resp = { held: parsed.key, total: 1 };
		else if (req.url === "/key_up") resp = { released: parsed.key };
		else if (req.url === "/mouse_down") resp = { held: `mouse${parsed.button || 1}`, x: parsed.x, y: parsed.y };
		else if (req.url === "/mouse_up") resp = { released: `mouse${parsed.button || 1}` };
		else if (req.url === "/release_all") resp = { released: ["a", "mouse1"], count: 2 };
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(resp));
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));
process.env.HAMMERSPOON_PORT = String(hsServer.address().port);

const { hsCall } = await import("../../computer-use/hammerspoon.mjs");

after(() => hsServer.close());
beforeEach(() => { requests.length = 0; });

// ── key_down / key_up ───────────────────────────────────────────────────────

describe("key_down", () => {
	it("sends POST /key_down with key name", async () => {
		const r = await hsCall("POST", "/key_down", { key: "w" });
		assert.equal(r.held, "w");
		const req = requests.find((r) => r.path === "/key_down");
		assert.ok(req);
		assert.equal(req.body.key, "w");
	});

	it("sends modifiers alongside key", async () => {
		const r = await hsCall("POST", "/key_down", { key: "a", modifiers: ["shift"] });
		assert.equal(r.held, "a");
		const req = requests.find((r) => r.path === "/key_down");
		assert.deepEqual(req.body.modifiers, ["shift"]);
	});
});

describe("key_up", () => {
	it("sends POST /key_up with key name", async () => {
		const r = await hsCall("POST", "/key_up", { key: "w" });
		assert.equal(r.released, "w");
	});
});

// ── mouse_down / mouse_up ───────────────────────────────────────────────────

describe("mouse_down", () => {
	it("sends coordinates and default button", async () => {
		const r = await hsCall("POST", "/mouse_down", { x: 500, y: 300 });
		assert.equal(r.held, "mouse1");
		const req = requests.find((r) => r.path === "/mouse_down");
		assert.equal(req.body.x, 500);
		assert.equal(req.body.y, 300);
	});

	it("supports right button", async () => {
		const r = await hsCall("POST", "/mouse_down", { x: 100, y: 100, button: 2 });
		assert.equal(r.held, "mouse2");
	});
});

describe("mouse_up", () => {
	it("sends POST /mouse_up", async () => {
		const r = await hsCall("POST", "/mouse_up", { button: 1 });
		assert.equal(r.released, "mouse1");
	});
});

// ── release_all ─────────────────────────────────────────────────────────────

describe("release_all", () => {
	it("sends POST /release_all and gets released list", async () => {
		const r = await hsCall("POST", "/release_all", {});
		assert.equal(r.count, 2);
		assert.ok(Array.isArray(r.released));
	});
});

/**
 * Unit tests for screenshot validation in hammerspoon.mjs.
 * Tests validatePng, readScreenshot null returns, and takeScreenshot retry logic.
 *
 * Run: node --test tests/computer-use/test_screenshot_validation.mjs
 */

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const SCREENSHOT = "/tmp/claude-screenshot.png";
const SCALED = "/tmp/claude-screenshot-scaled.png";

// Valid 1x1 red PNG
const PNG_1x1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
	"base64",
);

// ── Fake Hammerspoon server ─────────────────────────────────────────────────
let _hsResponse = { path: SCREENSHOT, width: 1280, height: 720 };
const hsServer = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(_hsResponse));
	});
});
await new Promise((r) => hsServer.listen(0, "127.0.0.1", r));
const { port } = hsServer.address();
process.env.HAMMERSPOON_PORT = String(port);

// Write valid PNG before importing (module may read at load)
writeFileSync(SCREENSHOT, PNG_1x1);

const { readScreenshot, takeScreenshot, scaleFactor } = await import(
	"../../computer-use/hammerspoon.mjs"
);

after(() => {
	hsServer.close();
	for (const p of [SCREENSHOT, SCALED]) {
		if (existsSync(p)) try { unlinkSync(p); } catch {}
	}
});

beforeEach(() => {
	writeFileSync(SCREENSHOT, PNG_1x1);
	_hsResponse = { path: SCREENSHOT, width: 1280, height: 720 };
});

// ── readScreenshot ──────────────────────────────────────────────────────────

describe("readScreenshot", () => {
	it("returns base64 for valid PNG", () => {
		const result = readScreenshot(1280);
		assert.ok(result, "should return non-null");
		const buf = Buffer.from(result, "base64");
		assert.ok(buf.length > 0, "decoded buffer should be non-empty");
	});

	it("returns null for missing file", () => {
		if (existsSync(SCREENSHOT)) unlinkSync(SCREENSHOT);
		const result = readScreenshot(1280);
		assert.equal(result, null, "should return null for missing file");
	});

	it("returns null for empty file", () => {
		writeFileSync(SCREENSHOT, "");
		const result = readScreenshot(1280);
		assert.equal(result, null, "should return null for empty file");
	});

	it("returns null for non-PNG file", () => {
		writeFileSync(SCREENSHOT, "this is not a png file at all");
		const result = readScreenshot(1280);
		assert.equal(result, null, "should return null for non-PNG");
	});

	it("returns null for truncated PNG header", () => {
		writeFileSync(SCREENSHOT, Buffer.from([0x89, 0x50, 0x4e])); // only 3 bytes
		const result = readScreenshot(1280);
		assert.equal(result, null, "should return null for truncated header");
	});
});

// ── takeScreenshot ──────────────────────────────────────────────────────────

describe("takeScreenshot", () => {
	it("returns image content for valid screenshot", async () => {
		const blocks = await takeScreenshot(10);
		const imgBlock = blocks.find((b) => b.type === "image");
		assert.ok(imgBlock, "should contain image block");
		assert.equal(imgBlock.mimeType, "image/png");
	});

	it("returns text fallback when screenshot is invalid", async () => {
		writeFileSync(SCREENSHOT, "not a png");
		const blocks = await takeScreenshot(10);
		assert.ok(blocks.length > 0);
		const textBlock = blocks.find((b) => b.type === "text");
		assert.ok(textBlock, "should have text block");
		assert.ok(
			textBlock.text.includes("invalid") || textBlock.text.includes("failed"),
			`text should indicate failure: ${textBlock.text}`,
		);
		const imgBlock = blocks.find((b) => b.type === "image");
		assert.equal(imgBlock, undefined, "should NOT send image block for invalid PNG");
	});

	it("returns text fallback when backend errors", async () => {
		_hsResponse = { error: "no screen" };
		const blocks = await takeScreenshot(10);
		const textBlock = blocks.find((b) => b.type === "text");
		assert.ok(textBlock);
		assert.ok(textBlock.text.includes("failed"), `should indicate failure: ${textBlock.text}`);
	});
});

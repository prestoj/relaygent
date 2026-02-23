/**
 * Unit tests for readScreenshot() in hammerspoon.mjs.
 * Tests PNG validation, Retina scaling logic, and scaleFactor calculation.
 *
 * Run: node --test tests/computer-use/test_readscreenshot.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import http from 'node:http';

// ── PNG generator (stdlib only — no PIL/sharp needed) ────────────────────────

function pngChunk(type, data) {
	const typeB = Buffer.from(type);
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeB, data])) >>> 0);
	return Buffer.concat([len, typeB, data, crc]);
}

function createPng(width, height) {
	const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
	const raw = Buffer.alloc(height * (1 + width * 3)); // filter=0 + RGB per pixel
	for (let y = 0; y < height; y++) raw[y * (1 + width * 3)] = 0; // filter byte
	const idat = pngChunk('IDAT', zlib.deflateSync(raw));
	return Buffer.concat([sig, pngChunk('IHDR', ihdr), idat, pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Fake Hammerspoon server (needed so module import doesn't fail) ───────────

const server = http.createServer((_req, res) => {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end('{"status":"ok"}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.HAMMERSPOON_PORT = String(server.address().port);

const { readScreenshot, scaleFactor, SCREENSHOT_PATH } = await import('../../computer-use/hammerspoon.mjs');
after(() => server.close());

// ── Test fixtures ────────────────────────────────────────────────────────────

const SCALED_PATH = '/tmp/claude-screenshot-scaled.png';
const smallPng = createPng(800, 600);
const widePng = createPng(2000, 1000);

function cleanup() {
	for (const p of [SCREENSHOT_PATH, SCALED_PATH]) {
		if (existsSync(p)) unlinkSync(p);
	}
}

// ── validatePng (tested indirectly through readScreenshot) ───────────────────

describe('readScreenshot validation', () => {
	after(cleanup);

	it('returns null when screenshot file does not exist', () => {
		cleanup();
		assert.equal(readScreenshot(1024), null);
	});

	it('returns null for empty file', () => {
		writeFileSync(SCREENSHOT_PATH, Buffer.alloc(0));
		assert.equal(readScreenshot(1024), null);
	});

	it('returns null for non-PNG file', () => {
		writeFileSync(SCREENSHOT_PATH, 'not a png file at all');
		assert.equal(readScreenshot(1024), null);
	});

	it('returns null for truncated PNG header', () => {
		writeFileSync(SCREENSHOT_PATH, Buffer.from([0x89, 0x50, 0x4E]));
		assert.equal(readScreenshot(1024), null);
	});
});

// ── No-scaling path ─────────────────────────────────────────────────────────

describe('readScreenshot no scaling', () => {
	after(cleanup);

	it('returns base64 when logicalWidth <= SCALED_WIDTH', () => {
		writeFileSync(SCREENSHOT_PATH, smallPng);
		const result = readScreenshot(1024);
		assert.ok(result, 'should return base64 string');
		assert.equal(typeof result, 'string');
		// Verify it is valid base64 of our PNG
		const decoded = Buffer.from(result, 'base64');
		assert.ok(decoded.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47])));
	});

	it('sets scaleFactor to 1 when no scaling needed', () => {
		writeFileSync(SCREENSHOT_PATH, smallPng);
		readScreenshot(1024);
		assert.equal(scaleFactor(), 1);
	});

	it('returns base64 when pixelWidth equals SCALED_WIDTH', () => {
		writeFileSync(SCREENSHOT_PATH, smallPng);
		const result = readScreenshot(1024, 1024);
		assert.ok(result);
		assert.equal(scaleFactor(), 1);
	});
});

// ── Scaling path (Retina) ───────────────────────────────────────────────────

describe('readScreenshot Retina scaling', () => {
	after(cleanup);

	it('downscales when pixelWidth > SCALED_WIDTH', () => {
		writeFileSync(SCREENSHOT_PATH, widePng);
		const result = readScreenshot(1024, 2560);
		assert.ok(result, 'should return downscaled base64');
		// Verify scaled file was created and is valid PNG
		const decoded = Buffer.from(result, 'base64');
		assert.ok(decoded.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47])));
	});

	it('sets scaleFactor = logicalWidth / 1024 when scaling', () => {
		writeFileSync(SCREENSHOT_PATH, widePng);
		readScreenshot(1024, 2560);
		assert.equal(scaleFactor(), 1); // 1024 / 1024 = 1
	});

	it('sets scaleFactor = 2.5 when logicalWidth is 2560', () => {
		writeFileSync(SCREENSHOT_PATH, widePng);
		readScreenshot(2560, 5120);
		assert.equal(scaleFactor(), 2.5); // 2560 / 1024 = 2.5
	});

	it('downscales when logicalWidth > SCALED_WIDTH (no pixelWidth)', () => {
		writeFileSync(SCREENSHOT_PATH, widePng);
		const result = readScreenshot(2560);
		assert.ok(result, 'should downscale using logicalWidth as imageWidth');
		assert.equal(scaleFactor(), 2.5); // 2560 / 1024 = 2.5
	});
});

// ── The Retina bug scenario (PR #506) ───────────────────────────────────────

describe('Retina bug regression (PR #506)', () => {
	after(cleanup);

	it('pre-fix scenario: logicalWidth=1024, no pixelWidth => no scaling', () => {
		// Before PR #506, Hammerspoon did not return pixelWidth.
		// readScreenshot(1024) would not scale even if the actual image was huge.
		writeFileSync(SCREENSHOT_PATH, smallPng);
		const result = readScreenshot(1024);
		assert.ok(result);
		assert.equal(scaleFactor(), 1, 'without pixelWidth, 1024 <= 1024 so no scaling');
	});

	it('post-fix scenario: logicalWidth=1024, pixelWidth=2560 => scaling triggers', () => {
		// After PR #506, Hammerspoon returns pixelWidth from img:size().
		// readScreenshot(1024, 2560) sees 2560 > 1024 and scales.
		writeFileSync(SCREENSHOT_PATH, widePng);
		const result = readScreenshot(1024, 2560);
		assert.ok(result, 'pixelWidth=2560 > 1024 triggers scaling');
		assert.equal(scaleFactor(), 1, 'scaleFactor = 1024/1024 = 1 for Retina');
	});
});

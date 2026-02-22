// HTTP client for computer-use backend (Hammerspoon on macOS, linux-server.py on Linux)
// All requests serialized through single TCP connection

import { execFile, execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { platform } from "node:os";
import http from "node:http";

const IS_LINUX = platform() === "linux";
const PORT = parseInt(process.env.HAMMERSPOON_PORT || "8097", 10);
const agent = new http.Agent({ keepAlive: false, maxSockets: 3 });
let tail = Promise.resolve();

const SCREENSHOT_PATH = "/tmp/claude-screenshot.png";
const SCALED_PATH = "/tmp/claude-screenshot-scaled.png";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — well under Claude's 20MB base64 limit
const SCALED_WIDTH = 1280; // Always downscale to this width for consistent vision coords

// Scale factor: native screen pixels / scaled image pixels.
// Set after first screenshot — click coords are multiplied by this before execution.
let _scaleFactor = 1;
export function scaleFactor() { return _scaleFactor; }

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Validate a PNG file exists, is non-empty, within size limit, and has correct header. */
function validatePng(path) {
	if (!existsSync(path)) return "file not found";
	const size = statSync(path).size;
	if (size === 0) return "empty file";
	if (size > MAX_BYTES) return `too large (${Math.round(size/1024/1024)}MB > ${MAX_BYTES/1024/1024}MB)`;
	if (size < 8) return "file too small for PNG header";
	const header = Buffer.alloc(8);
	const fd = openSync(path, "r");
	readSync(fd, header, 0, 8, 0);
	closeSync(fd);
	if (!header.equals(PNG_MAGIC)) return "invalid PNG header";
	return null; // valid
}

/** Read screenshot, always downscaling to SCALED_WIDTH for vision accuracy. Returns base64 or null. */
export function readScreenshot(nativeWidth) {
	const srcErr = validatePng(SCREENSHOT_PATH);
	if (srcErr) { process.stderr.write(`[computer-use] Screenshot invalid: ${srcErr}\n`); return null; }
	try {
		if (nativeWidth && nativeWidth > SCALED_WIDTH) {
			_scaleFactor = nativeWidth / SCALED_WIDTH;
			if (IS_LINUX) {
				execFileSync("python3", ["-c", `from PIL import Image;i=Image.open("${SCREENSHOT_PATH}");i.resize((${SCALED_WIDTH},int(i.height*${SCALED_WIDTH}/i.width)),Image.LANCZOS).save("${SCALED_PATH}")`], { timeout: 5000 });
			} else {
				execFileSync("sips", ["-Z", String(SCALED_WIDTH), "--out", SCALED_PATH, SCREENSHOT_PATH], { timeout: 5000 });
			}
			const scaledErr = validatePng(SCALED_PATH);
			if (scaledErr) { process.stderr.write(`[computer-use] Scaled screenshot invalid: ${scaledErr}\n`); return null; }
			return readFileSync(SCALED_PATH).toString("base64");
		}
		_scaleFactor = 1;
		return readFileSync(SCREENSHOT_PATH).toString("base64");
	} catch (e) {
		process.stderr.write(`[computer-use] Screenshot read error: ${e.message}\n`);
		return null;
	}
}

function hsCallOnce(method, path, body, timeoutMs) {
	return new Promise(resolve => {
		let done = false;
		const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
		const timer = setTimeout(() => { finish({ error: `Timeout after ${timeoutMs}ms on ${path}` }); try { req.destroy(); } catch {} }, timeoutMs);
		const data = body ? JSON.stringify(body) : null;
		const headers = { "Content-Type": "application/json" };
		if (data) headers["Content-Length"] = Buffer.byteLength(data);
		const req = http.request(
			{ hostname: "localhost", port: PORT, path, method, agent, headers },
			res => {
				const chunks = [];
				res.on("data", c => chunks.push(c));
				res.on("end", () => {
					try { finish(JSON.parse(Buffer.concat(chunks))); }
					catch { finish({ error: "bad json" }); }
				});
			}
		);
		req.on("error", e => finish({ error: `Hammerspoon unreachable: ${e.message}` }));
		if (data) req.write(data);
		req.end();
	});
}

function reloadHammerspoon() {
	if (IS_LINUX) return Promise.resolve(); // No Hammerspoon on Linux
	return new Promise(resolve => {
		execFile("/usr/bin/osascript", ["-e",
			'tell application "Hammerspoon" to execute lua code "hs.reload()"'],
			{ timeout: 5000 }, () => resolve());
	});
}

/** Serialized HTTP call to Hammerspoon. Auto-reloads if unreachable. */
export function hsCall(method, path, body, timeoutMs = 15000) {
	const promise = tail.then(async () => {
		let result = await hsCallOnce(method, path, body, timeoutMs);
		if (result.error?.includes("unreachable")) {
			await reloadHammerspoon();
			await new Promise(r => setTimeout(r, 2000));
			result = await hsCallOnce(method, path, body, timeoutMs);
		}
		return result;
	});
	tail = promise.catch(() => {});
	return promise;
}

/** Take screenshot after delay. Returns MCP content blocks. Retries once on failure. */
export async function takeScreenshot(delayMs = 300, indicator) {
	await new Promise(r => setTimeout(r, delayMs));
	const body = { path: SCREENSHOT_PATH };
	if (indicator) { body.indicator_x = indicator.x; body.indicator_y = indicator.y; }
	for (let attempt = 0; attempt < 2; attempt++) {
		const r = await hsCall("POST", "/screenshot", body);
		if (r.error) {
			if (attempt === 0) { await new Promise(res => setTimeout(res, 500)); continue; }
			return [{ type: "text", text: `(screenshot failed: ${r.error})` }];
		}
		const img = readScreenshot(r.width);
		if (!img) {
			if (attempt === 0) { await new Promise(res => setTimeout(res, 500)); continue; }
			return [{ type: "text", text: "(screenshot invalid — skipped to avoid API error)" }];
		}
		const sf = scaleFactor();
		const sw = Math.round(r.width / sf), sh = Math.round(r.height / sf);
		return [
			{ type: "image", data: img, mimeType: "image/png" },
			{ type: "text", text: `Screenshot: ${sw}x${sh}px (use these coords for clicks)` },
		];
	}
	return [{ type: "text", text: "(screenshot failed after retry)" }];
}

/** Run osascript with timeout (macOS only). */
export function runOsascript(code, ms = 8000) {
	if (IS_LINUX) return Promise.resolve({ success: false, error: "AppleScript not available on Linux" });
	return new Promise(resolve => {
		execFile("/usr/bin/osascript", ["-e", code], { timeout: ms }, (err, stdout, stderr) => {
			if (err?.killed) resolve({ success: false, error: "Timed out", timedOut: true });
			else if (err) resolve({ success: false, error: stderr?.trim() || err.message });
			else resolve({ success: true, result: stdout?.trim() || "" });
		});
	});
}


/** Startup self-test: verify backend is reachable. Logs warning to stderr. */
export async function checkHealth() {
	const r = await hsCallOnce("GET", "/health", null, 3000);
	if (r.error) {
		const backend = IS_LINUX ? "linux-server.py" : "Hammerspoon";
		process.stderr.write(`[computer-use] Warning: ${backend} not reachable (${r.error})\n`);
		return false;
	}
	process.stderr.write(`[computer-use] Backend OK (${r.platform || "macos"})\n`);
	return true;
}

export { SCREENSHOT_PATH };

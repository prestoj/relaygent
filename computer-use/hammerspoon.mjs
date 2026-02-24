// HTTP client for computer-use backend (Hammerspoon on macOS, linux-server.py on Linux)
// All requests serialized through single TCP connection

import { execFile } from "node:child_process";
import { platform } from "node:os";
import http from "node:http";
import { readScreenshot, readRawScreenshot, scaleFactor, SCREENSHOT_PATH } from "./screenshot-io.mjs";

// Re-export for consumers that import from hammerspoon.mjs
export { readScreenshot, readRawScreenshot, scaleFactor, SCREENSHOT_PATH };

const IS_LINUX = platform() === "linux";
const PORT = parseInt(process.env.HAMMERSPOON_PORT || "8097", 10);
const agent = new http.Agent({ keepAlive: false, maxSockets: 3 });
let tail = Promise.resolve();

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

/** Take screenshot after delay. Returns MCP content blocks. */
export async function takeScreenshot(delayMs = 300, indicator) {
	await new Promise(r => setTimeout(r, delayMs));
	const body = { path: SCREENSHOT_PATH };
	if (indicator) { body.indicator_x = indicator.x; body.indicator_y = indicator.y; }
	let r = await hsCall("POST", "/screenshot", body);
	if (r.error) return [{ type: "text", text: `(screenshot failed: ${r.error})` }];
	try {
		let img = readScreenshot(r.width, r.pixelWidth);
		// Retry once on invalid screenshot (timing issue — scrot can capture during window transition)
		if (!img) {
			await new Promise(res => setTimeout(res, 500));
			r = await hsCall("POST", "/screenshot", body);
			if (!r.error) img = readScreenshot(r.width, r.pixelWidth);
		}
		if (!img) return [{ type: "text", text: "(screenshot unavailable — image was invalid or too large)" }];
		const sf = scaleFactor();
		const sw = Math.round(r.width / sf), sh = Math.round(r.height / sf);
		return [
			{ type: "image", data: img, mimeType: "image/png" },
			{ type: "text", text: `Screenshot: ${sw}x${sh}px (use these coords for clicks)` },
		];
	} catch (e) { return [{ type: "text", text: `(screenshot read failed: ${e.message})` }]; }
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

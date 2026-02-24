// Screenshot reading, validation, and scaling for computer-use.
// Shared by hammerspoon.mjs (takeScreenshot) and screen-tools.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { platform } from "node:os";

const IS_LINUX = platform() === "linux";

export const SCREENSHOT_PATH = "/tmp/claude-screenshot.png";
const SCALED_PATH = "/tmp/claude-screenshot-scaled.png";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — well under Claude's 20MB base64 limit
const SCALED_WIDTH = 1024; // Downscale to Anthropic's recommended XGA width

// Scale factor: native screen pixels / scaled image pixels.
// Set after first screenshot — click coords are multiplied by this before execution.
let _scaleFactor = 1;
export function scaleFactor() { return _scaleFactor; }

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Validate a PNG file: check magic bytes, non-empty. Size check optional. */
function validatePng(path, checkSize = true) {
	try {
		const stat = statSync(path);
		if (stat.size === 0) return "empty file";
		if (checkSize && stat.size > MAX_BYTES) return `too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > ${MAX_BYTES / 1024 / 1024}MB)`;
		const fd = readFileSync(path, { start: 0, end: 7 });
		if (fd.length < 8 || !fd.subarray(0, 8).equals(PNG_MAGIC)) return "not a valid PNG";
	} catch (e) { return `read error: ${e.message}`; }
	return null;
}

/** Read screenshot, always downscaling to SCALED_WIDTH for vision accuracy. Returns base64 or null.
 * @param {number} logicalWidth - Logical/point screen width (used for click scaleFactor)
 * @param {number} [pixelWidth] - Actual image pixel width (used to decide if downscaling needed)
 */
export function readScreenshot(logicalWidth, pixelWidth) {
	const srcErr = validatePng(SCREENSHOT_PATH, false);
	if (srcErr) { process.stderr.write(`[computer-use] Bad screenshot: ${srcErr}\n`); return null; }
	const imageWidth = pixelWidth || logicalWidth;
	try {
		if (imageWidth && imageWidth > SCALED_WIDTH) {
			_scaleFactor = logicalWidth / SCALED_WIDTH;
			if (IS_LINUX) {
				execFileSync("python3", ["-c", `from PIL import Image;i=Image.open("${SCREENSHOT_PATH}");i.resize((${SCALED_WIDTH},int(i.height*${SCALED_WIDTH}/i.width)),Image.LANCZOS).save("${SCALED_PATH}")`], { timeout: 5000 });
			} else {
				execFileSync("sips", ["-Z", String(SCALED_WIDTH), "--out", SCALED_PATH, SCREENSHOT_PATH], { timeout: 5000 });
			}
			const scaledErr = validatePng(SCALED_PATH);
			if (scaledErr) { process.stderr.write(`[computer-use] Bad scaled screenshot: ${scaledErr}\n`); return null; }
			return readFileSync(SCALED_PATH).toString("base64");
		}
		_scaleFactor = 1;
		return readFileSync(SCREENSHOT_PATH).toString("base64");
	} catch (e) {
		process.stderr.write(`[computer-use] Screenshot read failed: ${e.message}\n`);
		return null;
	}
}

/** Read screenshot at native pixel resolution (no downscaling). For zoom/inspect use. */
export function readRawScreenshot() {
	const err = validatePng(SCREENSHOT_PATH);
	if (err) { process.stderr.write(`[computer-use] Bad zoom screenshot: ${err}\n`); return null; }
	return readFileSync(SCREENSHOT_PATH).toString("base64");
}

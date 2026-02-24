// Screenshot and zoom tools for computer-use MCP
import { z } from "zod";
import { hsCall, readScreenshot, readRawScreenshot, scaleFactor, SCREENSHOT_PATH } from "./hammerspoon.mjs";

const n = z.coerce.number();
const sx = (v) => Math.round(v * scaleFactor());

export function registerScreenTools(server) {
	server.tool("screenshot", "Capture screenshot. Use find_elements for precise coordinates.",
		{ x: n.optional().describe("Crop X"), y: n.optional().describe("Crop Y"),
			w: n.optional().describe("Crop width"), h: n.optional().describe("Crop height") },
		async ({ x, y, w, h }) => {
			const body = { path: SCREENSHOT_PATH };
			if (x !== null && y !== null && w !== null && h !== null) Object.assign(body, { x: sx(x), y: sx(y), w: sx(w), h: sx(h) });
			const r = await hsCall("POST", "/screenshot", body);
			if (r.error) return { content: [{ type: "text", text: JSON.stringify(r) }] };
			try {
				const img = readScreenshot(r.width, r.pixelWidth);
				if (!img) return { content: [{ type: "text", text: "(screenshot unavailable — image was invalid or too large)" }] };
				const sf = scaleFactor();
				const sw = Math.round(r.width / sf), sh = Math.round(r.height / sf);
				return { content: [
					{ type: "image", data: img, mimeType: "image/png" },
					{ type: "text", text: `Screenshot: ${sw}x${sh}px (use these coords for clicks)` },
				] };
			} catch { return { content: [{ type: "text", text: JSON.stringify(r) }] }; }
		}
	);

	server.tool("zoom", "Zoom in on a screen region at native resolution for better detail. Does NOT return clickable coords — use screenshot for that.",
		{ x: n.describe("Left X in screenshot coords"), y: n.describe("Top Y in screenshot coords"),
			w: n.describe("Width to crop"), h: n.describe("Height to crop") },
		async ({ x, y, w, h }) => {
			const body = { path: SCREENSHOT_PATH, x: sx(x), y: sx(y), w: sx(w), h: sx(h) };
			const r = await hsCall("POST", "/screenshot", body);
			if (r.error) return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
			const img = readRawScreenshot();
			if (!img) return { content: [{ type: "text", text: "(zoom failed — invalid image)" }] };
			return { content: [
				{ type: "image", data: img, mimeType: "image/png" },
				{ type: "text", text: `Zoomed (${x},${y}) ${w}x${h} at native res. Use full screenshot for clickable coords.` },
			] };
		}
	);
}

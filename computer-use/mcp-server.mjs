#!/usr/bin/env node
// MCP server for computer-use via Hammerspoon
// Tools auto-return screenshots after actions for immediate visual feedback

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { platform } from "node:os";
import { hsCall, takeScreenshot, readScreenshot, scaleFactor, checkHealth, SCREENSHOT_PATH } from "./hammerspoon.mjs";
import { registerBrowserTools } from "./browser-tools.mjs";
import { registerBrowserQueryTools } from "./browser-query.mjs";
import { registerBrowserNavTools } from "./browser-nav.mjs";
import { registerBrowserFileTools } from "./browser-files.mjs";
import { registerBrowserDialogTools } from "./browser-dialog.mjs";
import { registerNativeTools } from "./native-tools.mjs";
const IS_LINUX = platform() === "linux";

const server = new McpServer({ name: "computer-use", version: "1.0.0" });
const n = z.coerce.number();
// Claude sometimes serializes booleans as strings ("true"/"false") — coerce safely
const bool = z.preprocess(v => v === "true" ? true : v === "false" ? false : v, z.boolean().optional());
const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const ACTION_DELAY = 1500;
const actionRes = async (text, delay, indicator) => ({
	content: [{ type: "text", text }, ...await takeScreenshot(delay ?? ACTION_DELAY, indicator)]
});
/** Scale coordinates from image space to native screen space. */
const sx = (v) => Math.round(v * scaleFactor());

server.tool("screenshot", "Capture screenshot. Use find_elements for precise coordinates.",
	{ x: n.optional().describe("Crop X"), y: n.optional().describe("Crop Y"),
		w: n.optional().describe("Crop width"), h: n.optional().describe("Crop height") },
	async ({ x, y, w, h }) => {
		const body = { path: SCREENSHOT_PATH };
		if (x !== null && y !== null && w !== null && h !== null) Object.assign(body, { x: sx(x), y: sx(y), w: sx(w), h: sx(h) });
		const r = await hsCall("POST", "/screenshot", body);
		if (r.error) return { content: [{ type: "text", text: JSON.stringify(r) }] };
		try {
			const img = readScreenshot(r.width);
			const sf = scaleFactor();
			const sw = Math.round(r.width / sf), sh = Math.round(r.height / sf);
			return { content: [
				{ type: "image", data: img, mimeType: "image/png" },
				{ type: "text", text: `Screenshot: ${sw}x${sh}px (use these coords for clicks)` },
			] };
		} catch { return { content: [{ type: "text", text: JSON.stringify(r) }] }; }
	}
);

server.tool("click", "Click at coordinates. Auto-returns screenshot.",
	{ x: n.describe("X"), y: n.describe("Y"),
		right: bool.describe("Right-click"),
		double: bool.describe("Double-click"),
		modifiers: z.array(z.string()).optional().describe("Modifier keys: shift, cmd, alt, ctrl") },
	async (p) => { const np = { ...p, x: sx(p.x), y: sx(p.y) }; await hsCall("POST", "/click", np); return actionRes(`Clicked (${p.x},${p.y})`, 400, np); }
);

server.tool("click_sequence", "Multiple clicks in one call. Auto-returns screenshot.",
	{ clicks: z.array(z.object({
		x: n.describe("X"), y: n.describe("Y"),
		right: bool, double: bool,
		modifiers: z.array(z.string()).optional(),
		delay: n.optional().describe("Delay after click ms (default: 300)"),
	})).describe("Array of clicks") },
	async ({ clicks }) => {
		for (const c of clicks) {
			await hsCall("POST", "/click", { x: sx(c.x), y: sx(c.y), right: c.right, double: c.double, modifiers: c.modifiers });
			await new Promise(r => setTimeout(r, c.delay ?? 300));
		}
		const l = clicks[clicks.length - 1];
		return actionRes(`Clicked ${clicks.length} points`, 400, {x: sx(l.x), y: sx(l.y)});
	}
);

server.tool("drag", "Drag from one point to another. Auto-returns screenshot.",
	{ startX: n.describe("Start X"), startY: n.describe("Start Y"),
		endX: n.describe("End X"), endY: n.describe("End Y"),
		steps: n.optional().describe("Interpolation steps (default: 10)"),
		duration: n.optional().describe("Duration secs (default: 0.3)") },
	async (p) => {
		const np = { ...p, startX: sx(p.startX), startY: sx(p.startY), endX: sx(p.endX), endY: sx(p.endY) };
		await hsCall("POST", "/drag", np);
		return actionRes(`Dragged (${p.startX},${p.startY}) to (${p.endX},${p.endY})`, ((p.duration||0.3)+0.15)*1000);
	}
);

server.tool("type_text", "Type text or press keys. Auto-returns screenshot.",
	{ text: z.string().optional().describe("Text to type"),
		key: z.string().optional().describe("Key name (return, tab, escape, etc)"),
		modifiers: z.array(z.string()).optional().describe("Modifier keys") },
	async (p) => { const r = await hsCall("POST", "/type", p); return actionRes(JSON.stringify(r), 300); }
);

server.tool("type_sequence", "Multiple type/key actions in one call. Auto-returns screenshot.",
	{ actions: z.array(z.object({
		text: z.string().optional(), key: z.string().optional(),
		modifiers: z.array(z.string()).optional(),
		delay: n.optional().describe("Delay after action ms (default: 50)"),
	})).describe("Array of type actions") },
	async ({ actions }) => {
		for (const a of actions) {
			await hsCall("POST", "/type", { text: a.text, key: a.key, modifiers: a.modifiers });
			await new Promise(r => setTimeout(r, a.delay ?? 50));
		}
		return actionRes(`Executed ${actions.length} type actions`, 300);
	}
);

server.tool("scroll", "Scroll at position. Use repeat for long scrolling. Auto-returns screenshot.",
	{ x: n.optional().describe("X"), y: n.optional().describe("Y"),
		direction: z.enum(["up", "down"]).optional().describe("Direction (default: down)"),
		amount: n.optional().describe("Scroll units (default: 3)"),
		repeat: n.optional().describe("Number of scroll events (default: 1)") },
	async ({ x, y, direction, amount, repeat: reps }) => {
		const scrollAmt = (amount || 3) * (direction === "up" ? -1 : 1);
		await hsCall("POST", "/scroll", { x: x != null ? sx(x) : x, y: y != null ? sx(y) : y, amount: scrollAmt, repeat: reps || 1 });
		return actionRes(`Scrolled ${direction || "down"} x${reps || 1}`, ((reps||1)-1)*50+200);
	}
);

server.tool("type_from_file", "Type text from file (secure password entry). Auto-screenshots.",
	{ path: z.string().describe("Path to file") },
	async ({ path }) => { const r = await hsCall("POST", "/type_from_file", { path }); return actionRes(JSON.stringify(r)); }
);

server.tool("key_down", "Press and hold a key down without releasing. Use key_up to release. For gaming/held inputs.",
	{ key: z.string().describe("Key name (e.g. 'w', 'up', 'space', 'shift')"),
		modifiers: z.array(z.string()).optional().describe("Modifier keys to hold simultaneously") },
	async (p) => { const r = await hsCall("POST", "/key_down", p); return actionRes(JSON.stringify(r), 100); }
);

server.tool("key_up", "Release a previously held key.",
	{ key: z.string().describe("Key name to release"),
		modifiers: z.array(z.string()).optional().describe("Modifier keys to release") },
	async (p) => { const r = await hsCall("POST", "/key_up", p); return actionRes(JSON.stringify(r), 100); }
);

server.tool("mouse_down", "Press and hold a mouse button at position. Use mouse_up to release.",
	{ x: n.optional().describe("X coordinate"), y: n.optional().describe("Y coordinate"),
		button: n.optional().describe("Button: 1=left (default), 2=right") },
	async (p) => { const np = { ...p }; if (p.x != null) np.x = sx(p.x); if (p.y != null) np.y = sx(p.y); const r = await hsCall("POST", "/mouse_down", np); return actionRes(JSON.stringify(r), 100); }
);

server.tool("mouse_up", "Release a previously held mouse button.",
	{ x: n.optional().describe("X coordinate"), y: n.optional().describe("Y coordinate"),
		button: n.optional().describe("Button: 1=left (default), 2=right") },
	async (p) => { const np = { ...p }; if (p.x != null) np.x = sx(p.x); if (p.y != null) np.y = sx(p.y); const r = await hsCall("POST", "/mouse_up", np); return actionRes(JSON.stringify(r), 100); }
);

server.tool("release_all", "Release ALL held keys and mouse buttons. Safety valve for gaming.",
	{},
	async () => { const r = await hsCall("POST", "/release_all", {}); return actionRes(JSON.stringify(r), 100); }
);

server.tool("launch_app", "Launch or activate an application. Auto-returns screenshot.",
	{ app: z.string().describe("Application name") },
	async ({ app }) => { await hsCall("POST", "/launch", { app }); return actionRes(`Launched ${app}`, 500); }
);

server.tool("focus_window", "Focus a window by app name. Auto-returns screenshot.",
	{ window_id: n.optional().describe("Window ID"), app: z.string().optional().describe("App name") },
	async (p) => { const r = await hsCall("POST", "/focus", p); return actionRes(JSON.stringify(r), 200); }
);

registerBrowserTools(server, IS_LINUX);
registerBrowserQueryTools(server);
registerBrowserNavTools(server);
registerBrowserFileTools(server);
registerBrowserDialogTools(server);
registerNativeTools(server);

await checkHealth();
const transport = new StdioServerTransport();
await server.connect(transport);

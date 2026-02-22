// Native accessibility, dialog, and system tools for computer-use MCP
import { z } from "zod";
import { hsCall, takeScreenshot, scaleFactor, runOsascript } from "./hammerspoon.mjs";
import { findElements, clickElement } from "./a11y-client.mjs";

const n = z.coerce.number();
const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const actionRes = async (text, delay, indicator) => ({
	content: [{ type: "text", text }, ...await takeScreenshot(delay ?? 1500, indicator)]
});
const sx = (v) => Math.round(v * scaleFactor());

export function registerNativeTools(server) {
	server.tool("windows", "List all visible windows with positions", {},
		async () => jsonRes(await hsCall("GET", "/windows")));
	server.tool("apps", "List running applications", {},
		async () => jsonRes(await hsCall("GET", "/apps")));
	server.tool("element_at", "Get UI element info at screen coordinates",
		{ x: n.describe("X"), y: n.describe("Y") },
		async (p) => jsonRes(await hsCall("POST", "/element_at", { x: sx(p.x), y: sx(p.y) })));
	server.tool("accessibility_tree", "Get accessibility tree of focused or named app",
		{ app: z.string().optional().describe("App name (default: frontmost)"),
			depth: n.optional().describe("Max tree depth (default: 4)") },
		async (p) => jsonRes(await hsCall("POST", "/accessibility", p, 30000)));
	server.tool("find_elements", "Search UI elements by role/title in accessibility tree",
		{ role: z.string().optional().describe("AX role (e.g. AXButton)"),
			title: z.string().optional().describe("Title substring (case-insensitive)"),
			app: z.string().optional().describe("App name (default: frontmost)"),
			limit: n.optional().describe("Max results (default: 30)") },
		async (p) => jsonRes(await findElements(p)));

	server.tool("click_element", "Find UI element by title/role and click it. Auto-returns screenshot.",
		{ title: z.string().optional().describe("Title substring"),
			role: z.string().optional().describe("AX role (e.g. AXButton)"),
			app: z.string().optional().describe("App name (default: frontmost)"),
			index: n.optional().describe("Which match to click (default: 0)") },
		async (p) => {
			const r = await clickElement(p);
			if (r.error) return jsonRes(r);
			if (r.method === "AXPress") return actionRes(`Pressed "${r.element.title}" via AXPress`, 500);
			return actionRes(`Clicked "${r.element.title}" at (${r.coords.x},${r.coords.y})`, 400, r.coords);
		}
	);

	server.tool("dismiss_dialog", "Dismiss a macOS dialog or Chrome permission prompt (TCC, clipboard, notifications). Works on system dialogs and Chrome popups that CDP/CGEvent clicks can't reach.",
		{ button: z.string().optional().describe("Button to click (default: 'Don\\'t Allow'). Options: 'Don\\'t Allow', 'OK', 'Cancel', 'Allow'") },
		async ({ button }) => {
			const r = await hsCall("POST", "/dismiss_dialog", { button: button || "Don't Allow" });
			if (r.dismissed) return actionRes(`Dismissed dialog in ${r.app}`, 500);
			return jsonRes({ error: "No dismissible dialog found", detail: r });
		}
	);

	server.tool("applescript", "Run AppleScript via osascript.",
		{ code: z.string().describe("AppleScript code") },
		async ({ code }) => {
			let r = await runOsascript(code);
			for (let i = 0; i < 3 && r.timedOut; i++) {
				await hsCall("POST", "/type", { key: "return" }, 3000).catch(() => {});
				await new Promise(res => setTimeout(res, 1000));
				r = await runOsascript(code);
				if (!r.timedOut) break;
			}
			return jsonRes(r);
		}
	);

	server.tool("reload_config", "Reload Hammerspoon config", {},
		async () => jsonRes(await hsCall("POST", "/reload")));
}

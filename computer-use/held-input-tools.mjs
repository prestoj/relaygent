// Held input tools: key_down/up, mouse_down/up, mouse_move, release_all, input_sequence
// Extracted from mcp-server.mjs to keep it under 200 lines.
import { z } from "zod";
import { hsCall, takeScreenshot, scaleFactor } from "./hammerspoon.mjs";

const n = z.coerce.number();
const sx = (v) => Math.round(v * scaleFactor());
const actionRes = async (text, delay) => ({
	content: [{ type: "text", text }, ...await takeScreenshot(delay ?? 1500)]
});

export function registerHeldInputTools(server) {
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

	server.tool("mouse_move", "Move mouse cursor to coordinates without clicking. For camera control in 3D games.",
		{ x: n.describe("X"), y: n.describe("Y") },
		async (p) => { const r = await hsCall("POST", "/mouse_move", { x: sx(p.x), y: sx(p.y) }); return actionRes(JSON.stringify(r), 100); }
	);

	server.tool("release_all", "Release ALL held keys and mouse buttons. Safety valve for gaming.",
		{},
		async () => { const r = await hsCall("POST", "/release_all", {}); return actionRes(JSON.stringify(r), 100); }
	);

	server.tool("input_sequence", "Execute a timed sequence of key/mouse actions in one call. Eliminates round-trip latency for gaming combos.",
		{ actions: z.array(z.object({
			action: z.enum(["key_down", "key_up", "key_press", "mouse_down", "mouse_up", "mouse_move", "release_all"]).describe("Action type"),
			key: z.string().optional().describe("Key name (for key actions)"),
			modifiers: z.array(z.string()).optional().describe("Modifier keys"),
			x: n.optional().describe("X coordinate (for mouse actions)"),
			y: n.optional().describe("Y coordinate (for mouse actions)"),
			button: n.optional().describe("Mouse button: 1=left, 2=right"),
			delay: n.optional().describe("Delay in ms from start of sequence (0 = immediate)"),
		})).describe("Array of timed input actions") },
		async ({ actions }) => {
			const scaled = actions.map(a => ({ ...a, x: a.x != null ? sx(a.x) : a.x, y: a.y != null ? sx(a.y) : a.y }));
			const r = await hsCall("POST", "/input_sequence", { actions: scaled });
			const maxDelay = Math.max(...actions.map(a => a.delay || 0));
			return actionRes(JSON.stringify(r), maxDelay + 200);
		}
	);
}

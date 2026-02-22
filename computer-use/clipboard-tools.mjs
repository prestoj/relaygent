// Clipboard read/write tools for computer-use MCP
import { z } from "zod";
import { hsCall } from "./hammerspoon.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });

export function registerClipboardTools(server) {
	server.tool("clipboard_read", "Read current clipboard/pasteboard contents as text.",
		{},
		async () => jsonRes(await hsCall("GET", "/clipboard")));

	server.tool("clipboard_write", "Write text to the clipboard/pasteboard.",
		{ text: z.string().describe("Text to write to clipboard") },
		async ({ text }) => jsonRes(await hsCall("POST", "/clipboard", { text })));
}

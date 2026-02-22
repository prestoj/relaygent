// Explicit control over JavaScript dialogs (alert/confirm/prompt)
// By default, dialogs are auto-accepted. Use 'configure' to change next dialog behavior.
import { z } from "zod";
import { getLastDialog, setNextDialogConfig } from "./cdp.mjs";

export function registerBrowserDialogTools(server) {
	server.tool("browser_handle_dialog",
		"Control JavaScript dialogs (alert/confirm/prompt). 'status' shows last dialog info. 'configure' sets how the next dialog is handled (one-shot, reverts to auto-accept after).",
		{
			action: z.enum(["status", "configure"]).describe("'status' = last dialog info, 'configure' = set next dialog behavior"),
			accept: z.boolean().optional().describe("For configure: true=accept, false=dismiss (default: true)"),
			promptText: z.string().optional().describe("For configure: text to enter in prompt() dialogs"),
		},
		async ({ action, accept, promptText }) => {
			if (action === "status") {
				const d = getLastDialog();
				if (!d) return { content: [{ type: "text", text: "No JavaScript dialog has appeared yet." }] };
				return { content: [{ type: "text", text: JSON.stringify(d, null, 2) }] };
			}
			const config = { accept: accept !== false };
			if (promptText != null) config.promptText = promptText;
			setNextDialogConfig(config);
			const desc = config.accept ? "accepted" : "dismissed";
			const extra = promptText != null ? ` with text "${promptText}"` : "";
			return { content: [{ type: "text", text: `Next dialog will be ${desc}${extra}. Auto-accept resumes after.` }] };
		}
	);
}

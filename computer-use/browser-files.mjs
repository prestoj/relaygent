import { z } from "zod";
import { cdpSendCommand, cdpConnected } from "./cdp.mjs";
import { takeScreenshot } from "./hammerspoon.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });

export function registerBrowserFileTools(server) {
  server.tool("browser_upload",
    "Set file(s) on a file input element by CSS selector. Bypasses the OS file picker dialog.",
    { selector: z.string().describe("CSS selector for the <input type='file'> element"),
      files: z.array(z.string()).describe("Array of absolute file paths to upload") },
    async ({ selector, files }) => {
      if (!cdpConnected()) return jsonRes({ error: "CDP not connected — use browser_navigate first" });
      const doc = await cdpSendCommand("DOM.getDocument");
      if (!doc) return jsonRes({ error: "Failed to get document" });
      const node = await cdpSendCommand("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
      if (!node?.nodeId) return jsonRes({ error: `Element not found: ${selector}` });
      const result = await cdpSendCommand("DOM.setFileInputFiles", { files, nodeId: node.nodeId });
      if (!result) return jsonRes({ error: "Failed to set files" });
      return { content: [{ type: "text", text: `Set ${files.length} file(s) on ${selector}` }, ...await takeScreenshot(400)] };
    }
  );
}

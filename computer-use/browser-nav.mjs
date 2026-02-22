import { z } from "zod";
import { cdpSwitchTab, cdpCloseTab, cdpHttp } from "./cdp.mjs";
import { takeScreenshot } from "./hammerspoon.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });

export function registerBrowserNavTools(server) {
  server.tool("browser_switch_tab",
    "Switch to a specific Chrome tab by ID (from browser_tabs). Auto-returns screenshot.",
    { id: z.string().describe("Tab ID from browser_tabs output") },
    async ({ id }) => {
      const ok = await cdpSwitchTab(id);
      if (!ok) return jsonRes({ error: "Tab not found or activation failed" });
      return { content: [{ type: "text", text: `Switched to tab ${id}` }, ...await takeScreenshot(800)] };
    }
  );

  server.tool("browser_close_tab",
    "Close a Chrome tab by ID (from browser_tabs). Auto-returns screenshot.",
    { id: z.string().describe("Tab ID from browser_tabs output") },
    async ({ id }) => {
      const tabs = await cdpHttp("/json/list");
      const pages = tabs?.filter(t => t.type === "page") || [];
      if (pages.length <= 1) return jsonRes({ error: "Cannot close the last tab" });
      const ok = await cdpCloseTab(id);
      if (!ok) return jsonRes({ error: "Tab not found or close failed" });
      return { content: [{ type: "text", text: `Closed tab ${id}` }, ...await takeScreenshot(400)] };
    }
  );

  server.tool("browser_tabs", "List all open Chrome tabs with URLs and titles.", {}, async () => {
    const tabs = await cdpHttp("/json/list");
    if (!tabs) return jsonRes({ error: "CDP not available — Chrome may not be running" });
    const pages = tabs.filter(t => t.type === "page").map(t => ({ id: t.id, title: t.title, url: t.url }));
    return jsonRes({ tabs: pages, count: pages.length });
  });
}

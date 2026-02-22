import { z } from "zod";
import { cdpEval, cdpEvalAsync, cdpConnected } from "./cdp.mjs";
import { scaleFactor } from "./hammerspoon.mjs";
import { COORD_EXPR, WAIT_EXPR, _deep } from "./browser-exprs.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const cdpErr = (sel) => cdpConnected() ? `Element not found: ${sel}` : `CDP not connected — use browser_navigate to open a page first`;

export function registerBrowserQueryTools(server) {
  server.tool("browser_eval",
    "Run JavaScript in Chrome's active tab via CDP. Returns the result value. Use JSON.stringify() for objects.",
    { expression: z.string().describe("JavaScript expression to evaluate") },
    async ({ expression }) => jsonRes({ result: await cdpEval(expression) })
  );

  server.tool("browser_coords",
    "Get screen coordinates {sx, sy} for a CSS selector in Chrome. Use result with click().",
    { selector: z.string().describe("CSS selector (e.g. 'input', 'a.nav-link', '#submit')"),
      frame: z.coerce.number().optional().describe("iframe index (window.frames[N]) to search inside") },
    async ({ selector, frame }) => {
      const raw = await cdpEval(COORD_EXPR(selector, frame));
      if (!raw) return jsonRes({ error: cdpErr(selector) });
      try {
        const c = JSON.parse(raw), sf = scaleFactor();
        if (sf !== 1) { c.sx = Math.round(c.sx / sf); c.sy = Math.round(c.sy / sf); }
        return jsonRes(c);
      } catch { return jsonRes({ error: "Parse failed", raw }); }
    }
  );

  server.tool("browser_wait",
    "Wait for a CSS selector to appear in the page (polls up to timeout). Returns 'found' or 'timeout'.",
    { selector: z.string().describe("CSS selector to wait for"),
      timeout: z.coerce.number().optional().describe("Max wait ms, max 8000 (default: 5000)") },
    async ({ selector, timeout = 5000 }) => {
      const result = await cdpEvalAsync(WAIT_EXPR(selector, Math.min(timeout, 8000))).catch(() => null);
      return jsonRes({ status: result ?? "timeout", selector });
    }
  );

  server.tool("browser_get_text",
    "Get visible text content from the page or a specific element. Useful for reading content without screenshots.",
    { selector: z.string().optional().describe("CSS selector (default: body)"),
      max_length: z.coerce.number().optional().describe("Max characters (default: 4000)") },
    async ({ selector, max_length = 4000 }) => {
      const sel = selector ? `_dq(${JSON.stringify(selector)})` : `document.body`;
      const expr = `(function(){${_deep}var el=${sel};return el?(el.innerText||'').substring(0,${max_length}):'not found'})()`;
      const text = await cdpEval(expr);
      if (text === null) return jsonRes({ error: cdpErr(selector || 'body') });
      if (text === 'not found') return jsonRes({ error: `Element not found: ${selector}` });
      return jsonRes({ text, length: text.length });
    }
  );

  server.tool("browser_url",
    "Get the current page URL and title.",
    {},
    async () => {
      const r = await cdpEval(`JSON.stringify({url:location.href,title:document.title})`);
      if (!r) return jsonRes({ error: 'CDP not connected — use browser_navigate first' });
      try { return jsonRes(JSON.parse(r)); } catch { return jsonRes({ url: r }); }
    }
  );
}

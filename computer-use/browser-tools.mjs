import { z } from "zod";
import { hsCall, takeScreenshot } from "./hammerspoon.mjs";
import { cdpEval, cdpEvalAsync, cdpNavigate, cdpSyncToVisibleTab, cdpConnected, cdpSendCommand } from "./cdp.mjs";
import { patchChromePrefs, cdpChromePid } from "./cdp-chrome.mjs";
import { CLICK_EXPR, HOVER_EXPR, TEXT_CLICK_EXPR, TYPE_EXPR, TYPE_SLOW_EXPR, _deep, frameRoot } from "./browser-exprs.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const actionRes = async (text, delay) => ({ content: [{ type: "text", text }, ...await takeScreenshot(delay ?? 1500)] });
// Claude sometimes serializes booleans as strings ("true"/"false") — coerce safely
const bool = z.preprocess(v => v === "true" ? true : v === "false" ? false : v, z.boolean().optional());
const cdpErr = (sel) => cdpConnected() ? `Element not found: ${sel}` : `CDP not connected — use browser_navigate to open a page first`;

export function registerBrowserTools(server, IS_LINUX) {
  server.tool("browser_navigate",
    "Navigate browser to a URL via CDP (fast) or keyboard fallback. Auto-returns screenshot.",
    { url: z.string().describe("URL to navigate to"),
      new_tab: bool.describe("Open in new tab") },
    async ({ url, new_tab }) => {
      if (!new_tab && await cdpNavigate(url)) {
        // Focus the CDP Chrome's window by PID to avoid targeting stale Chrome instances
        const pid = IS_LINUX ? cdpChromePid() : null;
        if (pid) await hsCall("POST", "/focus", { pid });
        else await hsCall("POST", IS_LINUX ? "/focus" : "/launch", { app: IS_LINUX ? "google-chrome" : "Google Chrome" });
        return actionRes(`Navigated to ${url}`, 800);
      }
      const mod = IS_LINUX ? "ctrl" : "cmd";
      const browser = IS_LINUX ? "google-chrome" : "Google Chrome";
      if (!IS_LINUX) patchChromePrefs();
      await hsCall("POST", "/launch", { app: browser });
      await new Promise(r => setTimeout(r, 300));
      await hsCall("POST", "/type", { key: new_tab ? "t" : "l", modifiers: [mod] });
      await new Promise(r => setTimeout(r, 200));
      await hsCall("POST", "/type", { text: url });
      await new Promise(r => setTimeout(r, 100));
      await hsCall("POST", "/type", { key: "return" });
      await cdpSyncToVisibleTab(url);
      return actionRes(`Navigated to ${url}`, 1500);
    }
  );

  server.tool("browser_type",
    "Type text into a web input via JS injection (avoids address bar capture). Auto-returns screenshot.",
    { selector: z.string().describe("CSS selector for the input"),
      text: z.string().describe("Text to type"),
      submit: bool.describe("Submit form after typing (dispatches Enter + form.submit())"),
      slow: bool.describe("Type char-by-char with key events (for autocomplete/typeahead inputs)"),
      frame: z.coerce.number().optional().describe("iframe index (window.frames[N]) to target") },
    async ({ selector, text, submit, slow, frame }) => {
      const tagCheck = await cdpEval(`(function(){${_deep}var el=_dq(${JSON.stringify(selector)});return el&&el.tagName})()`);
      if (tagCheck === "SELECT") return jsonRes({ error: `Use browser_select for <select> elements` });
      const expr = slow ? TYPE_SLOW_EXPR(selector, text, submit, frame) : TYPE_EXPR(selector, text, submit, frame);
      const result = slow ? await cdpEvalAsync(expr) : await cdpEval(expr);
      if (result === "not found") return jsonRes({ error: `Element not found: ${selector}` });
      return actionRes(`Typed into ${selector}: "${text}"${slow ? " (slow)" : ""}${submit ? " (submitted)" : ""}`, submit ? 1500 : 400);
    }
  );

  server.tool("browser_click",
    "Click a web element by CSS selector — finds coords and clicks via CDP in one step. Auto-returns screenshot.",
    { selector: z.string().describe("CSS selector (e.g. 'button[type=submit]', 'a.nav-link', '#login')"),
      frame: z.coerce.number().optional().describe("iframe index (window.frames[N]) to search inside") },
    async ({ selector, frame }) => {
      const raw = await cdpEval(CLICK_EXPR(selector, frame));
      if (!raw) return jsonRes({ error: cdpErr(selector) });
      let coords;
      try { coords = JSON.parse(raw); } catch { return jsonRes({ error: "Parse failed", raw }); }
      return actionRes(`Clicked ${selector} at (${coords.sx},${coords.sy})`, 1000);
    }
  );

  server.tool("browser_click_text",
    "Click a visible element by its text content (links, buttons). Safer than browser_click when multiple elements share a selector. Auto-returns screenshot.",
    { text: z.string().describe("Text to search for (case-insensitive contains match)"),
      index: z.coerce.number().optional().describe("Which match to click if multiple (default: 0)"),
      frame: z.coerce.number().optional().describe("iframe index (window.frames[N]) to search inside") },
    async ({ text, index = 0, frame }) => {
      const raw = await cdpEval(TEXT_CLICK_EXPR(text, index, frame));
      if (!raw) return jsonRes({ error: cdpConnected() ? `No elements found containing: ${text}` : `CDP not connected — use browser_navigate to open a page first` });
      let coords;
      try { coords = JSON.parse(raw); } catch { return jsonRes({ error: "Parse failed", raw }); }
      if (coords.error) {
        const hints = [];
        if (coords.iframes) hints.push(`page has ${coords.iframes} iframe(s) — try frame: 0`);
        if (coords.canvas) hints.push(`page uses <canvas> — text may not be in DOM, use click() with coordinates`);
        if (coords.clickable === 0) hints.push(`no clickable elements found — page may not be loaded`);
        return jsonRes({ ...coords, ...(hints.length && { hints }) });
      }
      return actionRes(`Clicked "${coords.text}" at (${coords.sx},${coords.sy}) [${coords.count} matches]`, 1000);
    }
  );

  server.tool("browser_hover",
    "Hover over a web element by CSS selector — triggers CSS :hover and JS mouseover/mouseenter for dropdowns, tooltips, menus. Auto-returns screenshot.",
    { selector: z.string().describe("CSS selector (e.g. 'nav > li', '.dropdown-trigger', '#menu-item')"),
      frame: z.coerce.number().optional().describe("iframe index (window.frames[N]) to search inside") },
    async ({ selector, frame }) => {
      const raw = await cdpEval(HOVER_EXPR(selector, frame));
      if (!raw) return jsonRes({ error: cdpErr(selector) });
      let coords;
      try { coords = JSON.parse(raw); } catch { return jsonRes({ error: "Parse failed", raw }); }
      await cdpSendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.vx, y: coords.vy });
      return actionRes(`Hovered ${selector} at (${coords.sx},${coords.sy})`, 800);
    }
  );

  server.tool("browser_select",
    "Select a <select> option by visible text or value. Auto-returns screenshot.",
    { selector: z.string().describe("CSS selector for the <select> element"),
      option: z.string().describe("Option text or value to select"),
      frame: z.coerce.number().optional().describe("iframe index (window.frames[N]) to target") },
    async ({ selector, option, frame }) => {
      const expr = `(function(){${_deep}var ROOT=${frameRoot(frame)};var el=_dq(${JSON.stringify(selector)},ROOT);if(!el)return 'not found';` +
        `var o=Array.from(el.options).find(function(o){return o.text===${JSON.stringify(option)}||o.value===${JSON.stringify(option)}});` +
        `if(!o)return 'option not found';el.value=o.value;el.dispatchEvent(new Event('change',{bubbles:true}));return o.text})()`;
      const r = await cdpEval(expr);
      if (r === 'not found') return jsonRes({ error: `Element not found: ${selector}` });
      if (r === 'option not found') return jsonRes({ error: `Option not found: ${option}` });
      return actionRes(`Selected "${r}" in ${selector}`, 400);
    }
  );

  server.tool("browser_scroll",
    "Scroll within the web page by pixels (not screen scroll). Use for long pages. Auto-returns screenshot.",
    { x: z.coerce.number().optional().describe("Horizontal scroll pixels (default: 0)"),
      y: z.coerce.number().optional().describe("Vertical scroll pixels (default: 300, negative = up)"),
      selector: z.string().optional().describe("Scroll inside this element (default: window)") },
    async ({ x = 0, y = 300, selector }) => {
      const expr = selector
        ? `(function(){${_deep}var el=_dq(${JSON.stringify(selector)});if(el)el.scrollBy(${x},${y});return !!el})()`
        : `window.scrollBy(${x},${y});true`;
      await cdpEval(expr);
      return actionRes(`Scrolled (${x},${y})${selector ? ` in ${selector}` : ""}`, 300);
    }
  );

  server.tool("browser_fill", "Fill multiple form fields at once, more efficient than repeated browser_type calls. Auto-returns screenshot.",
    { fields: z.array(z.object({ selector: z.string(), value: z.string() })).describe("Array of {selector, value} pairs"),
      submit: z.string().optional().describe("CSS selector to click after filling"), frame: z.coerce.number().optional().describe("iframe index") },
    async ({ fields, submit, frame }) => {
      for (const f of fields) { const r = await cdpEval(TYPE_EXPR(f.selector, f.value, false, frame)); if (r === "not found") return jsonRes({ error: `Field not found: ${f.selector}` }); }
      if (submit) { const r = await cdpEval(CLICK_EXPR(submit, frame)); if (!r) return jsonRes({ error: cdpErr(submit) }); }
      return actionRes(`Filled ${fields.length} fields${submit ? ' and submitted' : ''}`, submit ? 1500 : 400);
    });
}

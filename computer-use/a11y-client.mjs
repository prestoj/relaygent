// Accessibility tree search and element interaction
// Extracted from hammerspoon.mjs to create headroom for new features
import { hsCall } from "./hammerspoon.mjs";
import { cdpEval, cdpConnected } from "./cdp.mjs";

// Short-lived cache for the a11y tree — reused within a single find→click sequence.
const _axCache = new Map(); // key: app|"" → { tree, ts }
const AX_CACHE_TTL = 1500;

function _getCachedTree(app) {
	const key = app || "";
	const entry = _axCache.get(key);
	if (entry && Date.now() - entry.ts < AX_CACHE_TTL) return entry.tree;
	return null;
}

function _setCachedTree(app, tree) {
	_axCache.set(app || "", { tree, ts: Date.now() });
}

// AX role → CSS selectors for DOM-based search inside Chrome
const _AX_SELECTORS = {
	AXbutton: "button,[role='button']", AXlink: "a[href],[role='link']",
	AXheading: "h1,h2,h3,h4,h5,h6,[role='heading']",
	AXtextField: "input:not([type=hidden]),[role='textbox'],textarea",
	AXimage: "img,[role='img']", AXcheckbox: "input[type=checkbox],[role='checkbox']",
	AXradio: "input[type=radio],[role='radio']", AXcomboBox: "select,[role='combobox']",
	AXmenuItem: "[role='menuitem']", AXtab: "[role='tab']",
};
const _ALL_SELECTOR = "a[href],button,input:not([type=hidden]),select,textarea," +
	"h1,h2,h3,h4,h5,h6,img,[role]";
const _TAG_ROLES = {
	a: "AXlink", button: "AXbutton", input: "AXtextField", select: "AXcomboBox",
	textarea: "AXtextArea", img: "AXimage", h1: "AXheading", h2: "AXheading",
	h3: "AXheading", h4: "AXheading", h5: "AXheading", h6: "AXheading",
};

function _isChrome(app) {
	if (!app) return true; // default = frontmost, likely Chrome
	const l = app.toLowerCase();
	return l.includes("chrome") || l.includes("chromium") || l.includes("browser");
}

/** Find elements inside Chrome via CDP JavaScript evaluation. */
async function _cdpFind(role, title, limit) {
	if (!cdpConnected()) return null;
	const sel = (role && _AX_SELECTORS[role]) || _ALL_SELECTOR;
	const titleJs = title ? JSON.stringify(title.toLowerCase()) : "null";
	const tagRoles = JSON.stringify(_TAG_ROLES);
	const expr = `(function(){
var R=${tagRoles},T=${titleJs},results=[];
var ox=window.screenX,oy=window.screenY+(window.outerHeight-window.innerHeight);
var els=document.querySelectorAll(${JSON.stringify(sel)});
for(var i=0;i<els.length&&results.length<${limit};i++){
  var e=els[i],r=e.getBoundingClientRect();
  if(r.width<1||r.height<1)continue;
  var txt=(e.innerText||e.value||e.alt||e.ariaLabel||e.title||'').substring(0,120).trim();
  if(T&&!txt.toLowerCase().includes(T))continue;
  var role=e.getAttribute('role');
  role=role?'AX'+role:R[e.tagName.toLowerCase()]||'AX'+e.tagName.toLowerCase();
  results.push({role:role,title:txt,frame:{x:Math.round(ox+r.x),y:Math.round(oy+r.y),w:Math.round(r.width),h:Math.round(r.height)}});
}return JSON.stringify(results)})()`;
	const raw = await cdpEval(expr);
	if (!raw) return null;
	try { return JSON.parse(raw); } catch { return null; }
}

/** Search accessibility tree for elements matching role/title. */
export async function findElements({ role, title, app, limit }) {
	const max = limit || 30;
	// Try CDP for Chrome content first — much richer than pyatspi
	if (_isChrome(app)) {
		const cdpResults = await _cdpFind(role, title, max);
		if (cdpResults && cdpResults.length > 0) {
			return { app: "Google Chrome", count: cdpResults.length, elements: cdpResults, source: "cdp" };
		}
	}
	// Fallback to native a11y (pyatspi on Linux, AX on macOS)
	const cached = _getCachedTree(app);
	const tree = cached ?? await hsCall("POST", "/accessibility", { app, depth: 8 }, 30000);
	if (tree.error) return { error: tree.error };
	if (!cached) _setCachedTree(app, tree);
	const results = [];
	const titleLower = title?.toLowerCase();
	function search(node) {
		if (!node || results.length >= max) return;
		const matchRole = !role || node.role === role;
		const nodeTitle = node.title || "";
		const nodeDesc = node.description || "";
		const matchTitle = !titleLower
			|| nodeTitle.toLowerCase().includes(titleLower)
			|| nodeDesc.toLowerCase().includes(titleLower);
		if (matchRole && matchTitle && (role || title)) {
			results.push({ role: node.role, title: nodeTitle || nodeDesc, frame: node.frame, value: node.value });
		}
		for (const c of node.children || []) {
			if (results.length < max) search(c);
		}
	}
	search(tree.tree);
	return { app: tree.app, count: results.length, elements: results };
}

/** Find element by title/role and click its center. Fallback to AXPress. */
export async function clickElement({ title, role, app, index }) {
	const result = await findElements({ title, role, app, limit: 10 });
	if (result.error) return { error: result.error };
	const valid = result.elements.filter(e => e.frame && e.frame.w > 0 && e.frame.h > 0);
	if (valid.length > 0) {
		const idx = Math.min(index || 0, valid.length - 1);
		const el = valid[idx];
		const x = Math.round(el.frame.x + el.frame.w / 2);
		const y = Math.round(el.frame.y + el.frame.h / 2);
		await hsCall("POST", "/click", { x, y });
		return { clicked: true, element: el, coords: { x, y }, candidates: valid.length };
	}
	if (result.count > 0) {
		const r = await hsCall("POST", "/ax_press", { title, role, app, index: index || 0 });
		if (r.pressed) return { clicked: true, element: { title: r.title, role: r.role }, method: "AXPress" };
		return { error: r.error || "AXPress failed", found: result.count, method: "AXPress" };
	}
	return { error: `No element found matching "${title || role}"` };
}

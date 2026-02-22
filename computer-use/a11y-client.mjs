// Accessibility tree search and element interaction
// Extracted from hammerspoon.mjs to create headroom for new features
import { hsCall } from "./hammerspoon.mjs";

// Short-lived cache for the a11y tree — reused within a single find→click sequence.
// TTL is intentionally brief (1.5s) so the cache is never stale in real interactions.
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

/** Search accessibility tree for elements matching role/title. */
export async function findElements({ role, title, app, limit }) {
	const cached = _getCachedTree(app);
	const tree = cached ?? await hsCall("POST", "/accessibility", { app, depth: 8 }, 30000);
	if (tree.error) return { error: tree.error };
	if (!cached) _setCachedTree(app, tree);
	const max = limit || 30;
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

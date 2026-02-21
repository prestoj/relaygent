import { KEY_MAP } from './screenKeys.js';

export function toNativeCoords(e, imgEl, nativeWidth) {
	const rect = imgEl.getBoundingClientRect();
	const effectiveW = nativeWidth || imgEl.naturalWidth;
	const effectiveH = imgEl.naturalWidth > 0
		? effectiveW * imgEl.naturalHeight / imgEl.naturalWidth
		: imgEl.naturalHeight;
	const scaleX = effectiveW / rect.width;
	const scaleY = effectiveH / rect.height;
	return { x: Math.round((e.clientX - rect.left) * scaleX), y: Math.round((e.clientY - rect.top) * scaleY) };
}

export async function sendScreenAction(body) {
	try {
		const res = await fetch('/api/screen/action', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) return { ok: false, error: (await res.json()).error };
		return { ok: true };
	} catch { return { ok: false, error: 'Network error' }; }
}

export function buildKeyAction(e) {
	const modifiers = [];
	if (e.metaKey) modifiers.push('cmd');
	if (e.ctrlKey) modifiers.push('ctrl');
	if (e.altKey) modifiers.push('alt');
	if (e.shiftKey) modifiers.push('shift');
	const mods = modifiers.length ? modifiers : undefined;
	const named = KEY_MAP[e.key];
	if (named) {
		return { body: { action: 'type', key: named, modifiers: mods }, label: `key: ${mods ? mods.join('+') + '+' : ''}${named}` };
	}
	if (e.key.length === 1) {
		if (e.metaKey || e.ctrlKey || e.altKey) {
			return { body: { action: 'type', key: e.key, modifiers: mods }, label: `key: ${mods.join('+')}+${e.key}` };
		}
		return { body: { action: 'type', text: e.key }, label: `type: "${e.key}"` };
	}
	return null;
}

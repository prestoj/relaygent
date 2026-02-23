import { KEY_MAP } from './screenKeys.js';

export function toNativeCoords(e, imgEl, nativeWidth) {
	const rect = imgEl.getBoundingClientRect();
	const natW = imgEl.naturalWidth, natH = imgEl.naturalHeight;
	const effectiveW = nativeWidth || natW;
	const effectiveH = natW > 0 ? effectiveW * natH / natW : natH;
	// Account for object-fit:contain letterboxing — visible image may be smaller than element
	const scale = Math.min(rect.width / natW, rect.height / natH);
	const visW = natW * scale, visH = natH * scale;
	const offX = (rect.width - visW) / 2, offY = (rect.height - visH) / 2;
	const relX = e.clientX - rect.left - offX, relY = e.clientY - rect.top - offY;
	const x = Math.round(relX * effectiveW / visW), y = Math.round(relY * effectiveH / visH);
	return { x: Math.max(0, Math.min(x, effectiveW - 1)), y: Math.max(0, Math.min(y, effectiveH - 1)) };
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

export function mouseModifiers(e) {
	const m = [];
	if (e.metaKey) m.push('cmd');
	if (e.ctrlKey) m.push('ctrl');
	if (e.altKey) m.push('alt');
	if (e.shiftKey) m.push('shift');
	return m.length ? m : undefined;
}

export function scrollAmount(deltaY) {
	return Math.max(1, Math.min(Math.ceil(Math.abs(deltaY) / 40), 10));
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

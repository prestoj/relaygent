/**
 * Tests for screenInteraction.js — coordinate mapping, action sending, key building.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let toNativeCoords, sendScreenAction, buildKeyAction;

before(async () => {
	({ toNativeCoords, sendScreenAction, buildKeyAction } = await import('../../hub/src/lib/screenInteraction.js'));
});

// ── toNativeCoords ─────────────────────────────────────────────────────────

test('toNativeCoords: maps client coords to native coords with scaling', () => {
	const imgEl = {
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }),
		naturalWidth: 1000, naturalHeight: 800,
	};
	const e = { clientX: 250, clientY: 200 };
	const { x, y } = toNativeCoords(e, imgEl, 0);
	assert.equal(x, 500);
	assert.equal(y, 400);
});

test('toNativeCoords: uses nativeWidth when provided', () => {
	const imgEl = {
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }),
		naturalWidth: 1000, naturalHeight: 800,
	};
	const e = { clientX: 250, clientY: 200 };
	const { x, y } = toNativeCoords(e, imgEl, 2000);
	assert.equal(x, 1000); // 250 * (2000/500)
	assert.equal(y, 800);  // 200 * (1600/400)
});

test('toNativeCoords: accounts for element offset', () => {
	const imgEl = {
		getBoundingClientRect: () => ({ left: 100, top: 50, width: 500, height: 400 }),
		naturalWidth: 1000, naturalHeight: 800,
	};
	const e = { clientX: 350, clientY: 250 };
	const { x, y } = toNativeCoords(e, imgEl, 0);
	assert.equal(x, 500); // (350-100) * (1000/500)
	assert.equal(y, 400); // (250-50) * (800/400)
});

// ── buildKeyAction ─────────────────────────────────────────────────────────

test('buildKeyAction: maps named key (Enter → return)', () => {
	const e = { key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
	const result = buildKeyAction(e);
	assert.ok(result);
	assert.deepEqual(result.body, { action: 'type', key: 'return', modifiers: undefined });
	assert.ok(result.label.includes('return'));
});

test('buildKeyAction: named key with modifiers', () => {
	const e = { key: 'Tab', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
	const result = buildKeyAction(e);
	assert.ok(result);
	assert.deepEqual(result.body, { action: 'type', key: 'tab', modifiers: ['cmd'] });
	assert.ok(result.label.includes('cmd'));
});

test('buildKeyAction: printable char without modifiers sends as text', () => {
	const e = { key: 'a', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
	const result = buildKeyAction(e);
	assert.ok(result);
	assert.deepEqual(result.body, { action: 'type', text: 'a' });
	assert.ok(result.label.includes('"a"'));
});

test('buildKeyAction: printable char with cmd sends as key + modifiers', () => {
	const e = { key: 'c', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
	const result = buildKeyAction(e);
	assert.ok(result);
	assert.deepEqual(result.body, { action: 'type', key: 'c', modifiers: ['cmd'] });
});

test('buildKeyAction: returns null for unrecognized multi-char key', () => {
	const e = { key: 'Shift', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true };
	const result = buildKeyAction(e);
	assert.equal(result, null);
});

test('buildKeyAction: multiple modifiers all included', () => {
	const e = { key: 'a', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true };
	const result = buildKeyAction(e);
	assert.ok(result);
	assert.deepEqual(result.body.modifiers, ['cmd', 'ctrl', 'alt', 'shift']);
});

test('buildKeyAction: space key maps to named key', () => {
	const e = { key: ' ', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
	const result = buildKeyAction(e);
	assert.ok(result);
	assert.equal(result.body.key, 'space');
});

test('buildKeyAction: arrow keys map correctly', () => {
	for (const [key, expected] of [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']]) {
		const e = { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
		const result = buildKeyAction(e);
		assert.ok(result);
		assert.equal(result.body.key, expected);
	}
});

// ── sendScreenAction ───────────────────────────────────────────────────────

test('sendScreenAction: returns ok:false with error on network failure', async () => {
	// fetch is not available in Node test environment — sendScreenAction catches the error
	const result = await sendScreenAction({ action: 'click', x: 0, y: 0 });
	assert.equal(result.ok, false);
	assert.ok(result.error);
});

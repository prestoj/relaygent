/**
 * Unit tests for browser-exprs.mjs — CDP JS expression builders.
 *
 * Pure string-building functions; no browser or Chrome required.
 * Run: node --test computer-use/test_browser_exprs.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	COORD_EXPR, CLICK_EXPR, TEXT_CLICK_EXPR,
	TYPE_EXPR, TYPE_SLOW_EXPR, WAIT_EXPR,
	_deep, _simClick, frameRoot,
} from '../../computer-use/browser-exprs.mjs';

describe('frameRoot', () => {
	it('returns document for undefined/null frame', () => {
		assert.equal(frameRoot(undefined), 'document');
		assert.equal(frameRoot(null), 'document');
	});

	it('returns window.frames[N].document for numeric frame', () => {
		assert.equal(frameRoot(0), 'window.frames[0].document');
		assert.equal(frameRoot(2), 'window.frames[2].document');
	});
});

describe('_deep', () => {
	it('is a non-empty string defining _dq and _dqa helpers', () => {
		assert.ok(typeof _deep === 'string' && _deep.length > 0);
		assert.ok(_deep.includes('function _dq(') && _deep.includes('function _dqa('));
	});
});

describe('_simClick', () => {
	it('defines _clk helper function', () => {
		assert.ok(_simClick.includes('var _clk=function(e)'));
	});

	it('dispatches PointerEvent pointerdown and pointerup', () => {
		assert.ok(_simClick.includes("PointerEvent('pointerdown'"));
		assert.ok(_simClick.includes("PointerEvent('pointerup'"));
	});

	it('dispatches MouseEvent mousedown, mouseup, and click', () => {
		assert.ok(_simClick.includes("MouseEvent('mousedown'"));
		assert.ok(_simClick.includes("MouseEvent('mouseup'"));
		assert.ok(_simClick.includes("MouseEvent('click'"));
	});

	it('calculates center coordinates from getBoundingClientRect', () => {
		assert.ok(_simClick.includes('getBoundingClientRect'));
		assert.ok(_simClick.includes('r.width/2') && _simClick.includes('r.height/2'));
	});

	it('sets bubbles and cancelable on dispatched events', () => {
		assert.ok(_simClick.includes('bubbles:true') && _simClick.includes('cancelable:true'));
	});
});

describe('COORD_EXPR', () => {
	it('returns an IIFE string', () => {
		const expr = COORD_EXPR('#btn', undefined);
		assert.ok(expr.startsWith('(function(){') && expr.trimEnd().endsWith(')()'));
	});

	it('embeds the selector JSON-escaped', () => {
		const sel = 'input[name="q"]';
		assert.ok(COORD_EXPR(sel, undefined).includes(JSON.stringify(sel)));
	});

	it('uses document ROOT when no frame', () => {
		assert.ok(COORD_EXPR('.foo', undefined).includes('ROOT=document'));
	});

	it('uses window.frames[N] when frame specified', () => {
		assert.ok(COORD_EXPR('.foo', 1).includes('window.frames[1].document'));
	});

	it('includes sx/sy screen coordinate calculation', () => {
		const expr = COORD_EXPR('a', undefined);
		assert.ok(expr.includes('sx:') && expr.includes('sy:'));
	});
});

describe('CLICK_EXPR', () => {
	it('is a string IIFE embedding the selector', () => {
		const expr = CLICK_EXPR('#submit', undefined);
		assert.ok(typeof expr === 'string');
		assert.ok(expr.includes(JSON.stringify('#submit')));
	});

	it('dispatches full pointer+mouse event sequence via _clk', () => {
		const expr = CLICK_EXPR('a', undefined);
		assert.ok(expr.includes('_clk(el)') && expr.includes('scrollIntoView'));
		assert.ok(expr.includes('PointerEvent') && expr.includes('MouseEvent'));
	});

	it('returns null when element not found', () => {
		assert.ok(CLICK_EXPR('a', undefined).includes('return null'));
	});
});

describe('TEXT_CLICK_EXPR', () => {
	it('is a string IIFE embedding text and index', () => {
		const expr = TEXT_CLICK_EXPR('Submit', 0, undefined);
		assert.ok(typeof expr === 'string');
		assert.ok(expr.includes(JSON.stringify('Submit')));
	});

	it('uses frame reference when provided', () => {
		assert.ok(TEXT_CLICK_EXPR('ok', 0, 2).includes('window.frames[2].document'));
	});

	it('embeds element index', () => {
		assert.ok(TEXT_CLICK_EXPR('btn', 3, undefined).includes('i=3'));
	});

	it('includes unicode normalization and error path', () => {
		const expr = TEXT_CLICK_EXPR('test', 0, undefined);
		assert.ok(expr.includes('norm=') && expr.includes("'No match'"));
	});

	it('dispatches full pointer+mouse event sequence via _clk', () => {
		const expr = TEXT_CLICK_EXPR('Submit', 0, undefined);
		assert.ok(expr.includes('_clk(el)'));
		assert.ok(expr.includes('PointerEvent') && expr.includes('MouseEvent'));
	});

	it('includes expanded role selectors for modern SPAs', () => {
		const expr = TEXT_CLICK_EXPR('btn', 0, undefined);
		assert.ok(expr.includes('[role=switch]'), 'missing [role=switch]');
		assert.ok(expr.includes('[role=checkbox]'), 'missing [role=checkbox]');
		assert.ok(expr.includes('[tabindex="0"]'), 'missing [tabindex="0"]');
	});

	it('includes TreeWalker fallback for bare text nodes', () => {
		const expr = TEXT_CLICK_EXPR('Large', 0, undefined);
		assert.ok(expr.includes('createTreeWalker'), 'missing TreeWalker fallback');
		assert.ok(expr.includes('NodeFilter.SHOW_TEXT'), 'should filter for text nodes');
	});
});

describe('TYPE_EXPR', () => {
	it('is a string IIFE embedding selector and text', () => {
		const expr = TYPE_EXPR('#q', 'search text', false, undefined);
		assert.ok(expr.includes(JSON.stringify('#q')));
		assert.ok(expr.includes(JSON.stringify('search text')));
	});

	it('returns "not found" when element missing', () => {
		assert.ok(TYPE_EXPR('input', 'hi', false, undefined).includes("'not found'"));
	});

	it('includes form submit logic only when submit=true', () => {
		assert.ok(TYPE_EXPR('input', 'q', true, undefined).includes('form') &&
			TYPE_EXPR('input', 'q', true, undefined).includes('submit'));
		assert.ok(!TYPE_EXPR('input', 'q', false, undefined).includes('form'));
	});

	it('fires input and change events', () => {
		const expr = TYPE_EXPR('input', 'x', false, undefined);
		assert.ok(expr.includes("'input'") && expr.includes("'change'"));
	});
});

describe('TYPE_SLOW_EXPR', () => {
	it('is a string IIFE embedding selector and text', () => {
		const expr = TYPE_SLOW_EXPR('#search', 'hello', false, undefined);
		assert.ok(expr.includes(JSON.stringify('#search')));
		assert.ok(expr.includes(JSON.stringify('hello')));
	});

	it('returns a Promise for async char-by-char typing', () => {
		assert.ok(TYPE_SLOW_EXPR('input', 'x', false, undefined).includes('new Promise'));
	});

	it('dispatches keydown/keypress/keyup per char', () => {
		const expr = TYPE_SLOW_EXPR('input', 'x', false, undefined);
		assert.ok(expr.includes('keydown') && expr.includes('keypress') && expr.includes('keyup'));
	});

	it('includes Enter submit when submit=true', () => {
		assert.ok(TYPE_SLOW_EXPR('input', 'q', true, undefined).includes('Enter'));
	});
});

describe('WAIT_EXPR', () => {
	it('is a string IIFE embedding selector and timeout', () => {
		const expr = WAIT_EXPR('.loading', 7500);
		assert.ok(expr.includes(JSON.stringify('.loading')) && expr.includes('7500'));
	});

	it('returns a Promise that resolves with "found"', () => {
		const expr = WAIT_EXPR('div', 1000);
		assert.ok(expr.includes('new Promise') && expr.includes("res('found')"));
	});

	it('polls via setTimeout(poll)', () => {
		assert.ok(WAIT_EXPR('div', 1000).includes('setTimeout(poll'));
	});
});

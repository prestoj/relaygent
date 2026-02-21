/**
 * Tests for hub/src/lib/sanitize.js
 * Run with: node --test hub/tests/sanitize.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from '../../hub/src/lib/sanitize.js';

test('sanitizeHtml: empty string returns empty string', () => {
	assert.equal(sanitizeHtml(''), '');
});

test('sanitizeHtml: null returns empty string', () => {
	assert.equal(sanitizeHtml(null), '');
});

test('sanitizeHtml: undefined returns empty string', () => {
	assert.equal(sanitizeHtml(undefined), '');
});

test('sanitizeHtml: plain text passes through unchanged', () => {
	assert.equal(sanitizeHtml('Hello, world!'), 'Hello, world!');
});

test('sanitizeHtml: removes script tags', () => {
	const result = sanitizeHtml('<script>alert("xss")</script>hello');
	assert.ok(!result.includes('<script>'), 'script tag should be removed');
	assert.ok(!result.includes('alert'), 'script content should be removed');
});

test('sanitizeHtml: removes onclick handlers', () => {
	const result = sanitizeHtml('<p onclick="evil()">text</p>');
	assert.ok(!result.includes('onclick'), 'onclick should be removed');
	assert.ok(result.includes('text'), 'text content should be preserved');
});

test('sanitizeHtml: removes onerror on img', () => {
	const result = sanitizeHtml('<img src="x" onerror="evil()">');
	assert.ok(!result.includes('onerror'), 'onerror should be removed');
});

test('sanitizeHtml: removes javascript: hrefs', () => {
	const result = sanitizeHtml('<a href="javascript:evil()">click</a>');
	assert.ok(!result.includes('javascript:'), 'javascript: href should be removed');
});

test('sanitizeHtml: preserves safe inline elements', () => {
	const result = sanitizeHtml('<strong>bold</strong> and <em>italic</em>');
	assert.ok(result.includes('bold'), 'bold text preserved');
	assert.ok(result.includes('italic'), 'italic text preserved');
});

test('sanitizeHtml: preserves safe block elements', () => {
	const result = sanitizeHtml('<p>paragraph</p><ul><li>item</li></ul>');
	assert.ok(result.includes('paragraph'), 'paragraph content preserved');
	assert.ok(result.includes('item'), 'list item preserved');
});

test('sanitizeHtml: preserves safe anchor tags', () => {
	const result = sanitizeHtml('<a href="https://example.com">link</a>');
	assert.ok(result.includes('href'), 'href preserved');
	assert.ok(result.includes('link'), 'link text preserved');
});

test('sanitizeHtml: removes iframe tags', () => {
	const result = sanitizeHtml('<iframe src="evil.com"></iframe>content');
	assert.ok(!result.includes('<iframe'), 'iframe should be removed');
	assert.ok(result.includes('content'), 'surrounding content preserved');
});

/**
 * Tests for hub/src/lib/activityFormat.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInput, extractResultText, summarizeResult } from '../../hub/src/lib/activityFormat.js';

// summarizeInput
test('summarizeInput: Bash returns command', () => {
	assert.equal(summarizeInput('Bash', { command: 'git status' }), 'git status');
});

test('summarizeInput: Read returns file_path with ~ substitution', () => {
	const result = summarizeInput('Read', { file_path: `${process.env.HOME}/test.js` });
	assert.equal(result, '~/test.js');
});

test('summarizeInput: Grep returns pattern', () => {
	const result = summarizeInput('Grep', { pattern: 'TODO', path: '/Users/x/src/foo.js' });
	assert.equal(result, '/TODO/ in foo.js');
});

test('summarizeInput: Grep without path', () => {
	assert.equal(summarizeInput('Grep', { pattern: 'fix' }), '/fix/');
});

test('summarizeInput: Glob returns pattern', () => {
	assert.equal(summarizeInput('Glob', { pattern: '**/*.js' }), '**/*.js');
});

test('summarizeInput: Edit returns file_path', () => {
	const result = summarizeInput('Edit', { file_path: `${process.env.HOME}/code.js` });
	assert.equal(result, '~/code.js');
});

test('summarizeInput: WebSearch returns query', () => {
	assert.equal(summarizeInput('WebSearch', { query: 'svelte 5 runes' }), 'svelte 5 runes');
});

test('summarizeInput: MCP tool returns first string value', () => {
	assert.equal(summarizeInput('mcp__slack__send_message', { channel: 'C123', text: 'hello' }), 'C123');
});

test('summarizeInput: empty input returns empty', () => {
	assert.equal(summarizeInput('Read', null), '');
	assert.equal(summarizeInput('Read', undefined), '');
});

// extractResultText
test('extractResultText: string content', () => {
	assert.equal(extractResultText('hello world'), 'hello world');
});

test('extractResultText: array with text blocks', () => {
	const content = [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }];
	assert.equal(extractResultText(content), 'line1\nline2');
});

test('extractResultText: array with image', () => {
	const content = [{ type: 'text', text: 'desc' }, { type: 'image' }];
	assert.equal(extractResultText(content), 'desc\n[image]');
});

test('extractResultText: empty/null', () => {
	assert.equal(extractResultText(null), '');
	assert.equal(extractResultText(''), '');
	assert.equal(extractResultText(undefined), '');
});

// summarizeResult
test('summarizeResult: short text unchanged', () => {
	assert.equal(summarizeResult('short'), 'short');
});

test('summarizeResult: long text truncated with ellipsis', () => {
	const long = 'a'.repeat(200);
	const result = summarizeResult(long);
	assert.ok(result.length <= 82);
	assert.ok(result.endsWith('…'));
});

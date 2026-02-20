/**
 * Tests for hub/src/lib/relayActivity.js
 * Uses Node.js built-in test runner.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let summarizeInput, extractResultText, summarizeResult, parseSession;

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-activity-test-'));
	({ summarizeInput, extractResultText, summarizeResult, parseSession } =
		await import('../src/lib/relayActivity.js'));
});

after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- summarizeInput ---

test('summarizeInput: Bash returns command slice', () => {
	const result = summarizeInput('Bash', { command: 'ls -la /home/user' });
	assert.equal(result, 'ls -la /home/user');
});

test('summarizeInput: Bash truncates long commands at 120 chars', () => {
	const cmd = 'x'.repeat(200);
	const result = summarizeInput('Bash', { command: cmd });
	assert.equal(result.length, 120);
});

test('summarizeInput: Read replaces HOME with ~', () => {
	const home = process.env.HOME;
	const result = summarizeInput('Read', { file_path: `${home}/some/file.js` });
	assert.equal(result, '~/some/file.js');
});

test('summarizeInput: Edit returns file_path with HOME replaced', () => {
	const home = process.env.HOME;
	const result = summarizeInput('Edit', { file_path: `${home}/foo.py` });
	assert.equal(result, '~/foo.py');
});

test('summarizeInput: Write returns file_path with HOME replaced', () => {
	const home = process.env.HOME;
	const result = summarizeInput('Write', { file_path: `${home}/bar.txt` });
	assert.equal(result, '~/bar.txt');
});

test('summarizeInput: Grep returns pattern with path basename', () => {
	const result = summarizeInput('Grep', { pattern: 'foo.*bar', path: '/some/dir/file.js' });
	assert.ok(result.includes('foo.*bar'));
	assert.ok(result.includes('file.js'));
});

test('summarizeInput: Grep without path omits in clause', () => {
	const result = summarizeInput('Grep', { pattern: 'myPattern' });
	assert.ok(result.includes('myPattern'));
	assert.ok(!result.includes(' in '));
});

test('summarizeInput: Glob returns pattern', () => {
	const result = summarizeInput('Glob', { pattern: '**/*.ts' });
	assert.equal(result, '**/*.ts');
});

test('summarizeInput: TodoWrite returns in_progress item content', () => {
	const result = summarizeInput('TodoWrite', {
		todos: [
			{ status: 'completed', content: 'done thing' },
			{ status: 'in_progress', content: 'current task' },
			{ status: 'pending', content: 'future task' },
		],
	});
	assert.equal(result, 'current task');
});

test('summarizeInput: TodoWrite with no in_progress returns empty', () => {
	const result = summarizeInput('TodoWrite', {
		todos: [{ status: 'completed', content: 'done' }],
	});
	assert.equal(result, '');
});

test('summarizeInput: WebFetch strips protocol and truncates', () => {
	const result = summarizeInput('WebFetch', { url: 'https://example.com/some/path' });
	assert.ok(!result.startsWith('https://'));
	assert.ok(result.includes('example.com'));
});

test('summarizeInput: WebSearch returns query', () => {
	const result = summarizeInput('WebSearch', { query: 'node.js testing' });
	assert.equal(result, 'node.js testing');
});

test('summarizeInput: Task returns description', () => {
	const result = summarizeInput('Task', { description: 'explore codebase' });
	assert.equal(result, 'explore codebase');
});

test('summarizeInput: unknown tool returns empty string', () => {
	const result = summarizeInput('UnknownTool', { foo: 'bar' });
	assert.equal(result, '');
});

test('summarizeInput: null input returns empty string', () => {
	const result = summarizeInput('Bash', null);
	assert.equal(result, '');
});

// --- extractResultText ---

test('extractResultText: string content returns trimmed text', () => {
	const result = extractResultText('  hello world  ');
	assert.equal(result, 'hello world');
});

test('extractResultText: array with text items joins them', () => {
	const result = extractResultText([
		{ type: 'text', text: 'foo' },
		{ type: 'text', text: 'bar' },
	]);
	assert.equal(result, 'foo\nbar');
});

test('extractResultText: array with image appends [image]', () => {
	const result = extractResultText([
		{ type: 'text', text: 'caption' },
		{ type: 'image', source: {} },
	]);
	assert.ok(result.includes('caption'));
	assert.ok(result.includes('[image]'));
});

test('extractResultText: image only returns [image]', () => {
	const result = extractResultText([{ type: 'image', source: {} }]);
	assert.equal(result, '[image]');
});

test('extractResultText: null returns empty string', () => {
	assert.equal(extractResultText(null), '');
});

test('extractResultText: empty array returns empty string', () => {
	assert.equal(extractResultText([]), '');
});

// --- summarizeResult ---

test('summarizeResult: short result returned as-is', () => {
	const result = summarizeResult('short text');
	assert.equal(result, 'short text');
});

test('summarizeResult: long result truncated at 80 chars with ellipsis', () => {
	const content = 'x'.repeat(200);
	const result = summarizeResult(content);
	assert.equal(result.length, 81); // 80 + ellipsis char
	assert.ok(result.endsWith('…'));
});

test('summarizeResult: null content returns empty string', () => {
	assert.equal(summarizeResult(null), '');
});

// --- parseSession ---

function makeJsonl(entries) {
	return entries.map(e => JSON.stringify(e)).join('\n');
}

test('parseSession: returns empty array for missing file', () => {
	const result = parseSession('/nonexistent/path/file.jsonl');
	assert.deepEqual(result, []);
});

test('parseSession: parses tool_use and text from assistant messages', () => {
	const sessionFile = path.join(tmpDir, 'session1.jsonl');
	const toolId = 'tool_abc123';
	const content = makeJsonl([
		{
			type: 'assistant',
			timestamp: '2026-02-19T10:00:00Z',
			message: {
				content: [
					{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'ls' } },
					{ type: 'text', text: 'Here is what I found in the directory.' },
				],
			},
		},
		{
			type: 'user',
			message: {
				content: [
					{ type: 'tool_result', tool_use_id: toolId, content: 'file1.txt\nfile2.txt' },
				],
			},
		},
	]);
	fs.writeFileSync(sessionFile, content);
	const result = parseSession(sessionFile);
	assert.ok(result.length >= 2);
	const tool = result.find(r => r.type === 'tool');
	assert.ok(tool, 'tool entry present');
	assert.equal(tool.name, 'Bash');
	assert.equal(tool.input, 'ls');
	assert.ok(tool.result.includes('file1.txt'));
	const text = result.find(r => r.type === 'text');
	assert.ok(text, 'text entry present');
	assert.ok(text.text.length > 10);
});

test('parseSession: skips text blocks shorter than 10 chars', () => {
	const sessionFile = path.join(tmpDir, 'session2.jsonl');
	const content = makeJsonl([
		{
			type: 'assistant',
			timestamp: '2026-02-19T10:00:00Z',
			message: { content: [{ type: 'text', text: 'OK' }] },
		},
	]);
	fs.writeFileSync(sessionFile, content);
	const result = parseSession(sessionFile);
	const textItems = result.filter(r => r.type === 'text');
	assert.equal(textItems.length, 0);
});

test('parseSession: tool with no result has empty result field', () => {
	const sessionFile = path.join(tmpDir, 'session3.jsonl');
	const content = makeJsonl([
		{
			type: 'assistant',
			timestamp: '2026-02-19T10:00:00Z',
			message: {
				content: [{ type: 'tool_use', id: 'no_result_id', name: 'Read', input: { file_path: '/foo' } }],
			},
		},
	]);
	fs.writeFileSync(sessionFile, content);
	const result = parseSession(sessionFile);
	const tool = result.find(r => r.type === 'tool');
	assert.ok(tool);
	assert.equal(tool.result, '');
});

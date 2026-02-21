/**
 * Tests for hub/src/lib/sessionSummary.js — session summarization.
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/sessionSummary.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set up temp HOME before importing (module reads HOME at load time)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-summary-test-'));
const origHome = process.env.HOME;
process.env.HOME = tmpHome;

// Create dirs the module expects
const dataDir = path.join(tmpHome, 'test-data');
const cacheDir = path.join(dataDir, 'session-summaries');
fs.mkdirSync(cacheDir, { recursive: true });
process.env.RELAYGENT_DATA_DIR = dataDir;

// Fake claude binary — reads stdin then echoes summary to stdout
const fakeBin = path.join(tmpHome, 'fake-claude');
fs.writeFileSync(fakeBin, '#!/bin/sh\ncat > /dev/null\necho "Test summary for session"');
fs.chmodSync(fakeBin, 0o755);
process.env.CLAUDE_CLI_PATH = fakeBin;

const { compactActivity, summarizeSession, summarizeCurrent } =
	await import('../../hub/src/lib/sessionSummary.js');

after(() => {
	process.env.HOME = origHome;
	delete process.env.RELAYGENT_DATA_DIR;
	delete process.env.CLAUDE_CLI_PATH;
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

// --- compactActivity ---

describe('compactActivity', () => {
	it('formats text items with [thought] prefix', () => {
		const activity = [{ type: 'text', text: 'Thinking about the problem' }];
		const result = compactActivity(activity);
		assert.ok(result.includes('[thought] Thinking about the problem'));
	});

	it('formats tool items with name, input, and result', () => {
		const activity = [{ type: 'tool', name: 'Bash', input: 'ls -la', result: 'file.txt' }];
		const result = compactActivity(activity);
		assert.ok(result.includes('[Bash] ls -la'));
		assert.ok(result.includes('→ file.txt'));
	});

	it('handles tool items with no input or result', () => {
		const activity = [{ type: 'tool', name: 'Read' }];
		const result = compactActivity(activity);
		assert.ok(result.includes('[Read]'));
	});

	it('respects maxItems parameter', () => {
		const activity = Array.from({ length: 10 }, (_, i) => ({ type: 'text', text: `Item ${i}` }));
		const result = compactActivity(activity, 3);
		// Should only include the last 3 items
		assert.ok(!result.includes('Item 0'));
		assert.ok(result.includes('Item 9'));
	});

	it('truncates long text to 150 chars', () => {
		const longText = 'x'.repeat(300);
		const activity = [{ type: 'text', text: longText }];
		const result = compactActivity(activity);
		// [thought] prefix + 150 chars of text
		assert.ok(result.length < 200);
	});

	it('truncates long input to 100 chars', () => {
		const activity = [{ type: 'tool', name: 'Bash', input: 'y'.repeat(200) }];
		const result = compactActivity(activity);
		const inputPart = result.split('[Bash] ')[1];
		assert.ok(inputPart.length <= 110); // 100 + some slack for result
	});

	it('truncates total output to 6000 chars', () => {
		const activity = Array.from({ length: 200 }, (_, i) => ({
			type: 'text', text: 'a'.repeat(100),
		}));
		const result = compactActivity(activity);
		assert.ok(result.length <= 6000);
	});

	it('returns empty string for empty activity', () => {
		assert.equal(compactActivity([]), '');
	});

	it('handles mixed activity types', () => {
		const activity = [
			{ type: 'text', text: 'Planning next step' },
			{ type: 'tool', name: 'Read', input: '/tmp/file.txt', result: 'contents here' },
			{ type: 'text', text: 'Analyzing results' },
		];
		const result = compactActivity(activity);
		assert.ok(result.includes('[thought] Planning'));
		assert.ok(result.includes('[Read]'));
		assert.ok(result.includes('[thought] Analyzing'));
	});
});

// --- summarizeSession (caching) ---

describe('summarizeSession', () => {
	it('returns null for activity with fewer than 3 items', async () => {
		const result = await summarizeSession('test-id-short', [{ type: 'text', text: 'hi' }]);
		assert.equal(result, null);
	});

	it('returns null for null activity', async () => {
		const result = await summarizeSession('test-id-null', null);
		assert.equal(result, null);
	});

	it('calls claude and returns summary for valid activity', async () => {
		const activity = Array.from({ length: 5 }, (_, i) => ({
			type: 'tool', name: 'Bash', input: `cmd${i}`, result: `out${i}`,
		}));
		const result = await summarizeSession('test-id-valid', activity);
		assert.ok(result.includes('Test summary'));
	});

	it('caches summary to file', async () => {
		const cacheFile = path.join(cacheDir, 'test-id-cached.txt');
		// Clean up any previous cache
		try { fs.unlinkSync(cacheFile); } catch {}
		const activity = Array.from({ length: 5 }, (_, i) => ({
			type: 'tool', name: 'Read', input: `/file${i}`, result: 'ok',
		}));
		await summarizeSession('test-id-cached', activity);
		assert.ok(fs.existsSync(cacheFile), 'cache file should be created');
		const cached = fs.readFileSync(cacheFile, 'utf-8');
		assert.ok(cached.includes('Test summary'));
	});

	it('returns cached summary without calling claude again', async () => {
		const cacheFile = path.join(cacheDir, 'test-id-precached.txt');
		fs.writeFileSync(cacheFile, 'Pre-cached summary');
		const result = await summarizeSession('test-id-precached', []);
		assert.equal(result, 'Pre-cached summary');
	});
});

// --- summarizeCurrent ---

describe('summarizeCurrent', () => {
	it('returns null when no session file exists', async () => {
		const result = await summarizeCurrent();
		assert.equal(result, null);
	});
});

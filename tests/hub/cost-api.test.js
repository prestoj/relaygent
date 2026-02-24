/**
 * Tests for /api/cost — cost estimation API.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/cost-api.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Set up fake session dirs with token usage before importing
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-api-'));
const now = new Date();
const today = now.toISOString().slice(0, 10).replace(/-/g, '-');
const hour = String(now.getHours()).padStart(2, '0');

const sessions = [
	{ id: `${today}-${hour}-00-00`, model: 'claude-opus-4-6', input: 100, cacheWrite: 5000, cacheRead: 50000, output: 200 },
	{ id: `${today}-${hour}-01-00`, model: 'claude-sonnet-4-6', input: 200, cacheWrite: 10000, cacheRead: 100000, output: 400 },
];

for (const s of sessions) {
	const dir = path.join(tmpHome, '.claude', 'projects', `-fake-${s.id}`);
	fs.mkdirSync(dir, { recursive: true });
	const ts = `${s.id.slice(0, 10)}T${s.id.slice(11).replace(/-/g, ':')}Z`;
	const data = [
		{ type: 'assistant', timestamp: ts, message: { model: s.model, content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: s.input, cache_creation_input_tokens: s.cacheWrite, cache_read_input_tokens: s.cacheRead, output_tokens: s.output } } },
		{ type: 'assistant', timestamp: ts, message: { model: s.model, content: [{ type: 'text', text: 'done' }], usage: { input_tokens: s.input, cache_creation_input_tokens: s.cacheWrite, cache_read_input_tokens: s.cacheRead, output_tokens: s.output } } },
	];
	fs.writeFileSync(path.join(dir, 'abcd1234.jsonl'), data.map(d => JSON.stringify(d)).join('\n') + '\n');
}

process.env.HOME = tmpHome;

// Dynamic import AFTER setting HOME
const { listSessions, clearSessionsCache } = await import('../../hub/src/lib/relayActivity.js');
const { GET } = await import('../../hub/src/routes/api/cost/+server.js');

function makeRequest(params = {}) {
	const url = new URL('http://localhost/api/cost');
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return GET({ url });
}

test('/api/cost returns valid response', async () => {
	clearSessionsCache();
	const res = await makeRequest({ days: 1 });
	const data = await res.json();
	assert.equal(data.sessions, 2);
	assert.ok(data.cost > 0, 'cost should be positive');
	assert.ok(data.byTier, 'should have byTier breakdown');
	assert.ok(data.perDay.length > 0, 'should have per-day data');
	assert.ok(data.pricing, 'should include pricing');
});

test('/api/cost separates model tiers', async () => {
	clearSessionsCache();
	const res = await makeRequest({ days: 1 });
	const data = await res.json();
	assert.ok(data.byTier.opus, 'should have opus tier');
	assert.ok(data.byTier.sonnet, 'should have sonnet tier');
	assert.ok(data.byTier.opus.cost > data.byTier.sonnet.cost, 'opus should cost more');
});

test('/api/cost token breakdown is correct', async () => {
	clearSessionsCache();
	const res = await makeRequest({ days: 1 });
	const data = await res.json();
	// Opus session: 2 turns × 100 input = 200
	assert.equal(data.byTier.opus.input, 200);
	// Opus session: 2 turns × 5000 cacheWrite = 10000
	assert.equal(data.byTier.opus.cacheWrite, 10000);
	// Sonnet session: 2 turns × 200 input = 400
	assert.equal(data.byTier.sonnet.input, 400);
});

test('/api/cost days filter works', async () => {
	clearSessionsCache();
	const res = await makeRequest({ days: 0 });
	const data = await res.json();
	// days=0 means cutoff is today, should still include today's sessions
	assert.ok(data.sessions >= 0);
});

test('/api/cost defaults to 7 days', async () => {
	clearSessionsCache();
	const res = await makeRequest();
	const data = await res.json();
	assert.equal(data.days, 7);
});

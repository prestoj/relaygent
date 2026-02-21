/**
 * Tests for hub/src/lib/linear.js — Linear API client.
 * Uses a fake GraphQL server to exercise queries without hitting real API.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Setup: temp HOME with API key + fake GraphQL server ─────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-test-'));
const keyDir = path.join(tmpDir, '.relaygent', 'linear');
fs.mkdirSync(keyDir, { recursive: true });
fs.writeFileSync(path.join(keyDir, 'api-key'), 'test-api-key-123');
process.env.HOME = tmpDir;

let lastRequest = null;
let mockResponse = { data: {} };

const gqlServer = http.createServer((req, res) => {
	let body = '';
	req.on('data', c => { body += c; });
	req.on('end', () => {
		lastRequest = { headers: req.headers, body: JSON.parse(body) };
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(mockResponse));
	});
});
await new Promise(r => gqlServer.listen(0, '127.0.0.1', r));
const { port } = gqlServer.address();

// Patch the API URL by re-importing with a module that overrides fetch
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
	const newUrl = url.replace('https://api.linear.app/graphql', `http://127.0.0.1:${port}/graphql`);
	return originalFetch(newUrl, opts);
};

const { isConfigured, getApiKey, listTeams, listIssues, createIssue, updateIssue } =
	await import('../../hub/src/lib/linear.js?t=' + Date.now());

after(() => {
	gqlServer.close();
	globalThis.fetch = originalFetch;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────────────

test('isConfigured returns true when API key exists', () => {
	assert.ok(isConfigured());
});

test('getApiKey reads key from file', () => {
	assert.equal(getApiKey(), 'test-api-key-123');
});

test('listTeams sends correct GraphQL query', async () => {
	mockResponse = { data: { teams: { nodes: [{ id: 't1', name: 'Engineering', key: 'ENG' }] } } };
	const teams = await listTeams();
	assert.equal(teams.length, 1);
	assert.equal(teams[0].name, 'Engineering');
	assert.equal(lastRequest.headers.authorization, 'test-api-key-123');
	assert.ok(lastRequest.body.query.includes('teams'));
});

test('listIssues returns issues with metadata', async () => {
	mockResponse = { data: { issues: {
		nodes: [{ id: 'i1', identifier: 'ENG-1', title: 'Fix bug', state: { name: 'Todo' } }],
		pageInfo: { hasNextPage: false, endCursor: null },
	} } };
	const result = await listIssues({ teamId: 't1' });
	assert.equal(result.nodes.length, 1);
	assert.equal(result.nodes[0].identifier, 'ENG-1');
});

test('listIssues with teamId includes filter', async () => {
	mockResponse = { data: { issues: { nodes: [], pageInfo: {} } } };
	await listIssues({ teamId: 'team-abc' });
	assert.ok(lastRequest.body.query.includes('team-abc'));
});

test('createIssue sends mutation with input', async () => {
	mockResponse = { data: { issueCreate: { success: true, issue: { id: 'i2', identifier: 'ENG-2', title: 'New feature', state: { name: 'Backlog' } } } } };
	const result = await createIssue({ teamId: 't1', title: 'New feature', description: 'Details here' });
	assert.ok(result.success);
	assert.equal(result.issue.title, 'New feature');
	assert.ok(lastRequest.body.query.includes('issueCreate'));
	assert.equal(lastRequest.body.variables.input.title, 'New feature');
	assert.equal(lastRequest.body.variables.input.description, 'Details here');
});

test('updateIssue sends mutation with id and updates', async () => {
	mockResponse = { data: { issueUpdate: { success: true, issue: { id: 'i1', identifier: 'ENG-1', title: 'Updated', state: { name: 'Done' } } } } };
	const result = await updateIssue('i1', { title: 'Updated' });
	assert.ok(result.success);
	assert.ok(lastRequest.body.query.includes('issueUpdate'));
	assert.equal(lastRequest.body.variables.id, 'i1');
});

test('GraphQL error throws with message', async () => {
	mockResponse = { errors: [{ message: 'Not authorized' }] };
	await assert.rejects(() => listTeams(), { message: 'Not authorized' });
});

test('isConfigured returns false when key missing', () => {
	const origKey = path.join(keyDir, 'api-key');
	const backup = fs.readFileSync(origKey);
	fs.unlinkSync(origKey);
	// Need fresh import to bypass cache — but since getApiKey reads file each time, just check it
	assert.equal(getApiKey(), null);
	fs.writeFileSync(origKey, backup);
});

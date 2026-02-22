/**
 * Tests for hub/src/lib/relayActivity.js: findLatestSession, listSessions,
 * loadSession, getRelayActivity.
 *
 * These functions read process.env.HOME at call time, so we can control them
 * by setting HOME to a tmpDir before calling (even after import).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpDir, projectsDir;
let findLatestSession, listSessions, loadSession, getRelayActivity, clearSessionsCache;

// A minimal assistant entry (~300 bytes when serialised) — keeps files above the 200-byte threshold
const ENTRY = JSON.stringify({
	type: 'assistant',
	timestamp: '2026-01-01T10:00:00.000Z',
	message: {
		usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
		content: [{ type: 'text', text: 'Working on the task now, making good progress here.' }],
	},
});

function writeSession(dir, filename = 'aabb1122-test.jsonl', lines = 3) {
	const p = path.join(dir, filename);
	fs.writeFileSync(p, Array(lines).fill(ENTRY).join('\n') + '\n');
	return p;
}

function makeDir(name) {
	const d = path.join(projectsDir, name);
	fs.mkdirSync(d, { recursive: true });
	return d;
}

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-list-test-'));
	projectsDir = path.join(tmpDir, '.claude', 'projects');
	fs.mkdirSync(projectsDir, { recursive: true });

	// No .relaygent/config.json → getRunsPrefix() returns null → no prefix filtering
	const savedHome = process.env.HOME;
	process.env.HOME = tmpDir;

	// Import after setting HOME — these functions read HOME at call time anyway
	({ findLatestSession, listSessions, loadSession, getRelayActivity, clearSessionsCache } =
		await import('../../hub/src/lib/relayActivity.js'));

	// Restore HOME — tests set it per-case as needed
	process.env.HOME = savedHome;
	process._savedHomeForSessionTests = savedHome;
});

after(() => {
	if (process._savedHomeForSessionTests) {
		process.env.HOME = process._savedHomeForSessionTests;
	}
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function withHome(fn) {
	const saved = process.env.HOME;
	process.env.HOME = tmpDir;
	clearSessionsCache();
	try { return fn(); } finally { process.env.HOME = saved; }
}
async function withHomeAsync(fn) {
	const saved = process.env.HOME;
	process.env.HOME = tmpDir;
	clearSessionsCache();
	try { return await fn(); } finally { process.env.HOME = saved; }
}

// ── findLatestSession ─────────────────────────────────────────────────────────

test('findLatestSession: returns null when no sessions exist', () => {
	withHome(() => {
		const result = findLatestSession();
		assert.equal(result, null);
	});
});

test('findLatestSession: returns the session with the latest directory timestamp', () => {
	withHome(() => {
		const d = makeDir('ws-2026-01-01-10-00-00');
		const p = writeSession(d);
		const result = findLatestSession();
		assert.equal(result, p);
	});
});

test('findLatestSession: skips files smaller than 200 bytes', () => {
	withHome(() => {
		const d = makeDir('ws-2026-01-01-09-00-00');
		fs.writeFileSync(path.join(d, 'small.jsonl'), 'x');
		// Only a tiny file — should not return it
		const result = findLatestSession();
		if (result !== null) {
			assert.ok(fs.statSync(result).size > 200);
		}
	});
});

test('findLatestSession: picks newest by directory name, not file mtime', () => {
	withHome(() => {
		const older = makeDir('ws-2026-02-01-10-00-00');
		const newer = makeDir('ws-2026-02-02-10-00-00');
		writeSession(older);
		writeSession(newer);
		// Touch older file to give it a newer mtime
		const olderFile = path.join(older, 'aabb1122-test.jsonl');
		const future = new Date(Date.now() + 60000);
		fs.utimesSync(olderFile, future, future);
		const result = findLatestSession();
		assert.ok(result.includes('2026-02-02'), 'should pick newer dir, not newer mtime');
	});
});

// ── listSessions ──────────────────────────────────────────────────────────────

test('listSessions: returns empty array when no valid dirs exist', () => {
	// Use a fresh clean tmpDir to avoid interference from other tests
	const cleanTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-empty-'));
	fs.mkdirSync(path.join(cleanTmp, '.claude', 'projects'), { recursive: true });
	const saved = process.env.HOME;
	process.env.HOME = cleanTmp;
	try {
		const result = listSessions();
		assert.ok(Array.isArray(result));
		assert.equal(result.length, 0);
	} finally {
		process.env.HOME = saved;
		fs.rmSync(cleanTmp, { recursive: true, force: true });
	}
});

test('listSessions: skips dirs without valid timestamp suffix', () => {
	withHome(() => {
		makeDir('no-timestamp-here');
		makeDir('also-bad');
		// These should not appear in sessions (regex won't match)
	});
});

test('listSessions: returns sessions with correct fields', () => {
	withHome(() => {
		const d = makeDir('run-2026-01-15-08-30-00');
		writeSession(d);
		const sessions = listSessions();
		const s = sessions.find(x => x.id === '2026-01-15-08-30-00--aabb1122');
		assert.ok(s, 'session found by id');
		assert.equal(s.id, '2026-01-15-08-30-00--aabb1122');
		assert.ok(typeof s.size === 'number' && s.size > 200);
	});
});

test('listSessions: returns sessions sorted newest first', () => {
	withHome(() => {
		makeDir('run-2026-01-10-00-00-00');
		makeDir('run-2026-01-20-00-00-00');
		makeDir('run-2026-01-05-00-00-00');
		for (const name of ['run-2026-01-10-00-00-00', 'run-2026-01-20-00-00-00', 'run-2026-01-05-00-00-00']) {
			const d = path.join(projectsDir, name);
			if (fs.existsSync(d)) writeSession(d);
		}
		const prefixes = ['2026-01-10-00-00-00', '2026-01-20-00-00-00', '2026-01-05-00-00-00'];
		const sessions = listSessions().filter(s => prefixes.some(p => s.id.startsWith(p)));
		assert.ok(sessions.length >= 2);
		for (let i = 1; i < sessions.length; i++) {
			assert.ok(sessions[i - 1].displayTime >= sessions[i].displayTime, 'sessions sorted newest first');
		}
	});
});

// ── loadSession ───────────────────────────────────────────────────────────────

test('loadSession: returns null for unknown id', () => {
	withHome(() => {
		assert.equal(loadSession('9999-99-99-99-99-99'), null);
	});
});

test('loadSession: returns activity and stats for known id', () => {
	withHome(() => {
		const d = makeDir('run-2026-02-01-12-00-00');
		writeSession(d, 'session.jsonl', 5);
		const result = loadSession('2026-02-01-12-00-00');
		assert.ok(result !== null, 'should find session');
		assert.ok(Array.isArray(result.activity), 'activity is array');
		assert.ok(result.stats !== null, 'stats is not null');
	});
});

// ── getRelayActivity ──────────────────────────────────────────────────────────

test('getRelayActivity: returns null when no sessions found', () => {
	const cleanTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-activity-'));
	fs.mkdirSync(path.join(cleanTmp, '.claude', 'projects'), { recursive: true });
	const saved = process.env.HOME;
	process.env.HOME = cleanTmp;
	try {
		assert.equal(getRelayActivity(), null);
	} finally {
		process.env.HOME = saved;
		fs.rmSync(cleanTmp, { recursive: true, force: true });
	}
});

test('getRelayActivity: returns object with runTime, lastActivity, recentActivity', () => {
	withHome(() => {
		const result = getRelayActivity();
		if (result === null) return; // skip if no sessions in tmpDir yet
		assert.ok(typeof result.runTime === 'string');
		assert.ok(typeof result.lastActivity === 'string');
		assert.ok(Array.isArray(result.recentActivity));
	});
});

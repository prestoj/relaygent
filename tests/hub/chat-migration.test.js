/**
 * Tests for chat.js migrateToEncrypted (lines 36-43).
 * Must pre-seed the DB with plaintext rows before importing chat.js,
 * so that the migration path is exercised on first getDb() call.
 * Run: node --import=./tests/helpers/kit-loader.mjs --test tests/chat-migration.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-migration-test-'));
const dbDir = path.join(tmpDir, 'hub-chat');
const dbPath = path.join(dbDir, 'chat.db');

// Pre-seed DB with plaintext messages BEFORE importing chat.js
fs.mkdirSync(dbDir, { recursive: true });
const seed = new Database(dbPath);
seed.exec(`
	CREATE TABLE messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		read INTEGER NOT NULL DEFAULT 0
	)
`);
seed.prepare("INSERT INTO messages (role, content) VALUES ('human', 'plaintext message one')").run();
seed.prepare("INSERT INTO messages (role, content) VALUES ('assistant', 'plaintext message two')").run();
seed.close();

process.env.RELAYGENT_DATA_DIR = tmpDir;
const { getMessage, getMessages } = await import('../../hub/src/lib/chat.js');

// Trigger getDb() now so migrateToEncrypted runs before any test reads the raw DB
getMessages(0);

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test('migrateToEncrypted: plaintext rows are encrypted on first getDb()', () => {
	// Read raw DB content — should now be encrypted (not plaintext)
	const raw = new Database(dbPath);
	const rows = raw.prepare('SELECT content FROM messages').all();
	raw.close();
	assert.equal(rows.length, 2);
	for (const row of rows) {
		assert.match(row.content, /^[0-9a-f]+$/i, `row content should be hex-encrypted: ${row.content}`);
		assert.ok(!row.content.includes('plaintext'), 'plaintext should be gone');
	}
});

test('migrateToEncrypted: encrypted rows are still readable via getMessage', () => {
	const msgs = getMessages(10);
	assert.equal(msgs.length, 2);
	// Content should be decrypted back to original plaintext when read via API
	const contents = msgs.map(m => m.content);
	assert.ok(contents.some(c => c.includes('plaintext message')));
});

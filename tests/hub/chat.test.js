/**
 * Tests for hub/src/lib/chat.js and chatCrypto.js
 * Run with: node --test hub/tests/chat.test.js
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Set RELAYGENT_DATA_DIR before importing chat.js (module uses it at init time)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

// Dynamic import after env is set (top-level await is valid in ESM)
const { sendHumanMessage, sendAssistantMessage, getMessage, getMessages,
        getUnreadHumanMessages, markAsRead, markAllRead } =
    await import('../../hub/src/lib/chat.js');

after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

test('sendHumanMessage: stores and returns message', () => {
    const msg = sendHumanMessage('Hello agent');
    assert.equal(msg.role, 'human');
    assert.equal(msg.content, 'Hello agent');
    assert.ok(msg.id > 0);
    assert.ok(msg.created_at);
});

test('sendAssistantMessage: stores and returns message', () => {
    const msg = sendAssistantMessage('Hello human');
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.content, 'Hello human');
    assert.ok(msg.id > 0);
});

test('getMessage: retrieves by id', () => {
    const sent = sendHumanMessage('Retrieve me');
    const got = getMessage(sent.id);
    assert.equal(got.id, sent.id);
    assert.equal(got.content, 'Retrieve me');
    assert.equal(got.role, 'human');
});

test('getMessage: returns undefined for nonexistent id', () => {
    assert.equal(getMessage(999999), undefined);
});

test('getMessages: returns messages in desc order', () => {
    const a = sendHumanMessage('First');
    const b = sendHumanMessage('Second');
    const ids = getMessages(10).map(m => m.id);
    assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
});

test('getMessages: respects limit', () => {
    for (let i = 0; i < 5; i++) sendHumanMessage(`Limit test ${i}`);
    assert.ok(getMessages(2).length <= 2);
});

test('getMessages: before parameter paginates correctly', () => {
    const a = sendHumanMessage('Page A');
    const b = sendHumanMessage('Page B');
    const older = getMessages(100, b.id);
    const olderIds = older.map(m => m.id);
    assert.ok(!olderIds.includes(b.id));
    assert.ok(olderIds.includes(a.id));
});

test('getUnreadHumanMessages: returns unread human messages', () => {
    const msg = sendHumanMessage('Unread test ' + Date.now());
    assert.ok(getUnreadHumanMessages().some(m => m.id === msg.id));
});

test('getUnreadHumanMessages: does not include assistant messages', () => {
    const msg = sendAssistantMessage('Assistant unread test');
    assert.ok(!getUnreadHumanMessages().some(m => m.id === msg.id));
});

test('markAsRead: marks specific messages read', () => {
    const msg = sendHumanMessage('Mark me read ' + Date.now());
    assert.ok(getUnreadHumanMessages().some(m => m.id === msg.id));
    markAsRead([msg.id]);
    assert.ok(!getUnreadHumanMessages().some(m => m.id === msg.id));
});

test('markAsRead: handles empty/null gracefully', () => {
    assert.doesNotThrow(() => markAsRead([]));
    assert.doesNotThrow(() => markAsRead(null));
});

test('markAllRead: clears all unread human messages', () => {
    sendHumanMessage('Batch unread 1 ' + Date.now());
    sendHumanMessage('Batch unread 2 ' + Date.now());
    markAllRead();
    assert.equal(getUnreadHumanMessages().length, 0);
});

test('content is encrypted at rest in DB', () => {
    const msg = sendHumanMessage('Secret content');
    const dbPath = path.join(tmpDir, 'hub-chat', 'chat.db');
    const raw = new Database(dbPath).prepare('SELECT content FROM messages WHERE id = ?').get(msg.id);
    assert.notEqual(raw.content, 'Secret content');
    assert.match(raw.content, /^[0-9a-f]+$/i);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// chatUtils uses marked + sanitizeHtml which need the hub module system,
// but isRelayMsg and groupMessages are pure logic — test them directly.
function isRelayMsg(m) {
	return m.role === 'assistant' && /^\[relay\]/.test(m.content || '');
}

function groupMessages(messages) {
	const groups = [];
	let batch = [];
	for (const m of messages) {
		if (isRelayMsg(m)) { batch.push(m); }
		else {
			if (batch.length) { groups.push({ relay: true, msgs: batch }); batch = []; }
			groups.push({ relay: false, msg: m });
		}
	}
	if (batch.length) groups.push({ relay: true, msgs: batch });
	return groups;
}

const relay1 = { role: 'assistant', content: '[relay] New session — Context at 87%', created_at: '2026-02-23T12:00:00Z' };
const relay2 = { role: 'assistant', content: '[relay] Sleeping — waiting for notifications', created_at: '2026-02-23T12:01:00Z' };
const relay3 = { role: 'assistant', content: '[relay] New session — Context at 90% after wake', created_at: '2026-02-23T12:02:00Z' };
const human1 = { role: 'human', content: 'Hello', created_at: '2026-02-23T12:03:00Z' };
const bot1 = { role: 'assistant', content: 'Hi there!', created_at: '2026-02-23T12:04:00Z' };

describe('isRelayMsg', () => {
	it('detects relay messages', () => {
		assert.ok(isRelayMsg(relay1));
		assert.ok(isRelayMsg(relay2));
	});
	it('rejects non-relay assistant messages', () => {
		assert.ok(!isRelayMsg(bot1));
	});
	it('rejects human messages even with [relay] prefix', () => {
		assert.ok(!isRelayMsg({ role: 'human', content: '[relay] test' }));
	});
	it('handles empty/missing content', () => {
		assert.ok(!isRelayMsg({ role: 'assistant', content: '' }));
		assert.ok(!isRelayMsg({ role: 'assistant' }));
	});
});

describe('groupMessages', () => {
	it('returns empty array for no messages', () => {
		assert.deepStrictEqual(groupMessages([]), []);
	});
	it('groups consecutive relay messages', () => {
		const groups = groupMessages([relay1, relay2, relay3]);
		assert.equal(groups.length, 1);
		assert.ok(groups[0].relay);
		assert.equal(groups[0].msgs.length, 3);
	});
	it('keeps non-relay messages as individual groups', () => {
		const groups = groupMessages([human1, bot1]);
		assert.equal(groups.length, 2);
		assert.ok(!groups[0].relay);
		assert.equal(groups[0].msg, human1);
		assert.ok(!groups[1].relay);
		assert.equal(groups[1].msg, bot1);
	});
	it('separates relay groups from normal messages', () => {
		const groups = groupMessages([relay1, relay2, human1, bot1, relay3]);
		assert.equal(groups.length, 4);
		assert.ok(groups[0].relay);
		assert.equal(groups[0].msgs.length, 2);
		assert.ok(!groups[1].relay);
		assert.equal(groups[1].msg, human1);
		assert.ok(!groups[2].relay);
		assert.equal(groups[2].msg, bot1);
		assert.ok(groups[3].relay);
		assert.equal(groups[3].msgs.length, 1);
	});
	it('handles single relay message as group of 1', () => {
		const groups = groupMessages([human1, relay1, bot1]);
		assert.equal(groups.length, 3);
		assert.ok(groups[1].relay);
		assert.equal(groups[1].msgs.length, 1);
	});
});

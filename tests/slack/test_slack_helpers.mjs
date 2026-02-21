/**
 * Tests for slack-helpers.mjs — formatText, dmName, userName.
 * Uses dependency injection (resolveUser param) for formatText/dmName.
 * Run: node --test tests/slack/test_slack_helpers.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatText, dmName } from "../../slack/slack-helpers.mjs";

// Mock resolver: returns a fixed name for known UIDs
const mockResolve = async (uid) => {
	const names = { U1234: "Alice", U5678: "Bob", UABCD: "Charlie" };
	return names[uid] || uid;
};

describe("formatText", () => {
	it("returns empty string for null/undefined/empty", async () => {
		assert.equal(await formatText(null, mockResolve), "");
		assert.equal(await formatText(undefined, mockResolve), "");
		assert.equal(await formatText("", mockResolve), "");
	});

	it("passes through plain text unchanged", async () => {
		assert.equal(await formatText("hello world", mockResolve), "hello world");
	});

	it("resolves single user mention", async () => {
		assert.equal(await formatText("hi <@U1234>!", mockResolve), "hi @Alice!");
	});

	it("resolves multiple user mentions", async () => {
		const input = "<@U1234> and <@U5678> are here";
		assert.equal(await formatText(input, mockResolve), "@Alice and @Bob are here");
	});

	it("resolves duplicate user mentions", async () => {
		const input = "<@U1234> said hi to <@U1234>";
		assert.equal(await formatText(input, mockResolve), "@Alice said hi to @Alice");
	});

	it("resolves labeled links", async () => {
		const input = "check <https://example.com|this link>";
		assert.equal(await formatText(input, mockResolve), "check this link");
	});

	it("resolves bare URL links", async () => {
		const input = "see <https://example.com/path>";
		assert.equal(await formatText(input, mockResolve), "see https://example.com/path");
	});

	it("resolves http links (not just https)", async () => {
		const input = "<http://localhost:8080>";
		assert.equal(await formatText(input, mockResolve), "http://localhost:8080");
	});

	it("handles mentions and links together", async () => {
		const input = "<@U1234> shared <https://example.com|a doc> with <@U5678>";
		const expected = "@Alice shared a doc with @Bob";
		assert.equal(await formatText(input, mockResolve), expected);
	});

	it("leaves unknown UIDs as-is from resolver", async () => {
		const input = "hi <@UUNKNOWN>";
		assert.equal(await formatText(input, mockResolve), "hi @UUNKNOWN");
	});

	it("does not resolve non-user angle brackets", async () => {
		const input = "use <code> tags";
		assert.equal(await formatText(input, mockResolve), "use <code> tags");
	});

	it("handles complex URLs with query params", async () => {
		const input = "<https://example.com/path?q=1&r=2|search results>";
		assert.equal(await formatText(input, mockResolve), "search results");
	});
});

describe("dmName", () => {
	it("formats IM channel with resolved user", async () => {
		const ch = { is_im: true, user: "U1234", name: "alice" };
		assert.equal(await dmName(ch, mockResolve), "DM: Alice");
	});

	it("formats MPIM channel with group name", async () => {
		const ch = { is_mpim: true, name: "mpdm-alice--bob-1" };
		assert.equal(await dmName(ch, mockResolve), "Group DM: mpdm-alice--bob-1");
	});

	it("formats regular channel with hash prefix", async () => {
		const ch = { name: "general" };
		assert.equal(await dmName(ch, mockResolve), "#general");
	});

	it("prefers is_im over is_mpim when both set", async () => {
		const ch = { is_im: true, is_mpim: true, user: "U5678", name: "weird" };
		assert.equal(await dmName(ch, mockResolve), "DM: Bob");
	});
});

/**
 * Tests for unread-check.mjs and formatTs in slack-helpers.mjs.
 * Run: node --test tests/slack/test_unread_check.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTs } from "../../slack/slack-helpers.mjs";

describe("formatTs", () => {
	it("formats a Slack timestamp to Pacific time", () => {
		// 1700000000 = 2023-11-14T22:13:20Z
		const result = formatTs("1700000000.000000");
		assert.ok(result.includes("2023"), "should contain year");
		assert.ok(result.includes("11") || result.includes("Nov"), "should contain month");
	});

	it("returns empty string for falsy input", () => {
		assert.equal(formatTs(null), "");
		assert.equal(formatTs(undefined), "");
		assert.equal(formatTs(""), "");
	});

	it("handles timestamp without microseconds", () => {
		const result = formatTs("1700000000");
		assert.ok(result.length > 0, "should produce output");
	});
});

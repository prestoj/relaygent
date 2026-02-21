/**
 * Tests for oauth-helpers.mjs — constants and pure helper functions.
 * Run: node --test tests/slack/test_oauth_helpers.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CALLBACK_PORT, SCOPES, TOKEN_PATH } from "../../slack/oauth-helpers.mjs";

describe("oauth-helpers constants", () => {
	it("CALLBACK_PORT is 3333", () => {
		assert.equal(CALLBACK_PORT, 3333);
	});

	it("SCOPES contains required scopes", () => {
		const scopes = SCOPES.split(",");
		assert.ok(scopes.includes("chat:write"), "missing chat:write");
		assert.ok(scopes.includes("channels:read"), "missing channels:read");
		assert.ok(scopes.includes("search:read"), "missing search:read");
		assert.ok(scopes.includes("users:read"), "missing users:read");
		assert.ok(scopes.includes("reactions:write"), "missing reactions:write");
		assert.equal(scopes.length, 16, "expected 16 scopes");
	});

	it("TOKEN_PATH ends with expected path", () => {
		assert.ok(TOKEN_PATH.endsWith(".relaygent/slack/token.json"));
	});
});

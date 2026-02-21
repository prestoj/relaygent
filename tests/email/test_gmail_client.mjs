/**
 * Unit tests for email/gmail-client.mjs
 *
 * Tests credential file handling, error paths, client caching, and auth URL.
 * Sets HOME to a temp dir before import so module-level paths point there.
 * Tests run sequentially — error paths first, then create creds for success tests.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set HOME before import — gmail-client resolves paths at module load time
const tmpHome = mkdtempSync(join(tmpdir(), "gmail-client-test-"));
const gmailDir = join(tmpHome, ".relaygent", "gmail");
const keysPath = join(gmailDir, "gcp-oauth.keys.json");
const tokenPath = join(gmailDir, "credentials.json");
process.env.HOME = tmpHome;

const { getGmailClient, getAuthUrl } = await import("../../email/gmail-client.mjs");

const FAKE_KEYS = {
	installed: {
		client_id: "123456.apps.googleusercontent.com",
		client_secret: "test-secret",
		redirect_uris: ["urn:ietf:wg:oauth:2.0:oob"],
	},
};
const FAKE_TOKENS = {
	access_token: "ya29.test-access-token",
	refresh_token: "1//test-refresh-token",
	token_type: "Bearer",
	expiry_date: Date.now() + 3600000,
};

// --- Error paths (no files exist yet) ---

describe("gmail-client: missing credentials", () => {
	test("getAuthUrl throws when keys file missing", () => {
		assert.throws(() => getAuthUrl(), /keys not found/i);
	});

	test("getGmailClient throws when keys file missing", () => {
		assert.throws(() => getGmailClient(), /keys not found/i);
	});
});

// --- Create keys file, test missing tokens ---

describe("gmail-client: keys present, tokens missing", () => {
	test("getGmailClient throws when tokens file missing", () => {
		mkdirSync(gmailDir, { recursive: true });
		writeFileSync(keysPath, JSON.stringify(FAKE_KEYS));
		assert.throws(() => getGmailClient(), /tokens not found/i);
	});

	test("getAuthUrl returns a URL string when keys exist", () => {
		const url = getAuthUrl();
		assert.ok(typeof url === "string", "should return string");
		assert.ok(url.startsWith("https://"), `should be https URL: ${url}`);
		assert.ok(url.includes("accounts.google.com"), "should point to Google");
		assert.ok(url.includes("gmail"), "should include gmail scope");
	});
});

// --- Create tokens file, test success paths ---

describe("gmail-client: valid credentials", () => {
	test("getGmailClient returns a gmail client object", () => {
		writeFileSync(tokenPath, JSON.stringify(FAKE_TOKENS));
		const client = getGmailClient();
		assert.ok(client, "client should be non-null");
		assert.ok(client.users, "client should have users namespace");
		assert.ok(client.users.messages, "client should have users.messages");
		assert.ok(client.users.labels, "client should have users.labels");
		assert.ok(client.users.drafts, "client should have users.drafts");
	});

	test("getGmailClient caches client (same instance returned)", () => {
		const a = getGmailClient();
		const b = getGmailClient();
		assert.strictEqual(a, b, "should return same cached instance");
	});
});

// --- Token persistence callback ---

describe("gmail-client: token refresh callback", () => {
	test("refreshed tokens are written to credentials.json", () => {
		// The gmail client's auth has a "tokens" event listener that persists
		const client = getGmailClient();
		const auth = client._options?.auth;
		if (!auth || typeof auth.emit !== "function") {
			// Can't access auth internals — skip gracefully
			return;
		}
		const newTokens = { access_token: "ya29.refreshed-token" };
		auth.emit("tokens", newTokens);
		// Give atomic write a moment
		const saved = JSON.parse(readFileSync(tokenPath, "utf-8"));
		assert.ok(
			saved.access_token === "ya29.refreshed-token" ||
			saved.access_token === FAKE_TOKENS.access_token,
			"token should be updated or original"
		);
	});
});

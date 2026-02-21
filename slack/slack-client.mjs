/**
 * Slack Web API client — user tokens (xoxp-).
 * Token from ~/.relaygent/slack/token.json: { "access_token": "xoxp-..." }
 * Rate-limit aware with automatic retry on 429.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SLACK_DIR = join(homedir(), ".relaygent", "slack");
const TOKEN_PATH = join(SLACK_DIR, "token.json");
const BASE_URL = process.env.SLACK_API_URL || "https://slack.com/api";

let token = null;

export function getToken() {
	if (token) return token;
	if (!existsSync(TOKEN_PATH)) {
		throw new Error(
			`Slack token not found at ${TOKEN_PATH}. ` +
			`Create it with: { "access_token": "xoxp-..." }`
		);
	}
	const data = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
	token = data.access_token;
	if (!token) throw new Error("No access_token in token.json");
	process.stderr.write("[slack] Token loaded\n");
	return token;
}

const MAX_RETRIES = 3;

// In-memory response cache for read-only methods
const _cache = new Map();
const CACHE_TTL = 5000; // 5s
const CACHEABLE = new Set([
	"conversations.history", "conversations.list", "conversations.info",
	"users.info", "users.list",
]);

function _cacheKey(method, params) {
	return method + "|" + JSON.stringify(params, Object.keys(params).sort());
}

export async function slackApi(method, params = {}, _retries = 0) {
	// Check cache for read-only methods
	if (CACHEABLE.has(method)) {
		const key = _cacheKey(method, params);
		const cached = _cache.get(key);
		if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
	}

	const t = getToken();
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v != null) body.append(k, String(v));
	}
	const res = await fetch(`${BASE_URL}/${method}`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${t}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
	});
	if (res.status === 429) {
		if (_retries >= MAX_RETRIES) throw new Error(`Slack ${method}: rate limited after ${MAX_RETRIES} retries`);
		const retry = parseInt(res.headers.get("Retry-After") || "5", 10);
		process.stderr.write(`[slack] Rate limited, retrying in ${retry}s (${_retries + 1}/${MAX_RETRIES})\n`);
		await new Promise(r => setTimeout(r, retry * 1000));
		return slackApi(method, params, _retries + 1);
	}
	const data = await res.json();
	if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);

	// Store in cache
	if (CACHEABLE.has(method)) {
		const key = _cacheKey(method, params);
		_cache.set(key, { data, ts: Date.now() });
	}
	return data;
}

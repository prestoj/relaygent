// OAuth helper functions for Slack token setup
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { execSync } from "child_process";

export const CALLBACK_PORT = 3333;
export const TOKEN_PATH = join(homedir(), ".relaygent", "slack", "token.json");
export const SCOPES = [
	"channels:history", "channels:read", "channels:write",
	"chat:write",
	"groups:history", "groups:read", "groups:write",
	"im:history", "im:read", "im:write",
	"mpim:history", "mpim:read", "mpim:write",
	"reactions:write", "search:read", "users:read",
].join(",");

/** Generate a self-signed cert for localhost. Returns {key, cert} or null. */
export function makeSelfSignedCert() {
	const [k, c] = [join(tmpdir(), "rl-slack-key.pem"), join(tmpdir(), "rl-slack-cert.pem")];
	try {
		execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${k}" -out "${c}" -days 1 -nodes -subj "/CN=localhost"`, { stdio: "ignore" });
		return { key: readFileSync(k), cert: readFileSync(c) };
	} catch { return null; }
}

export function openBrowser(url) {
	try {
		const cmd = process.platform === "darwin" ? "open" : "xdg-open";
		execSync(`${cmd} "${url}"`, { stdio: "ignore" });
		return true;
	} catch { return false; }
}

export function saveToken(token) {
	mkdirSync(join(homedir(), ".relaygent", "slack"), { recursive: true });
	writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: token }, null, 2));
	console.log(`\n✓ Token saved to ${TOKEN_PATH}`);
}

export async function exchangeCode(clientId, clientSecret, code, redirectUri) {
	const body = new URLSearchParams({
		client_id: clientId, client_secret: clientSecret,
		code, redirect_uri: redirectUri,
	});
	const res = await fetch("https://slack.com/api/oauth.v2.access", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	return res.json();
}

export async function verifyToken(token) {
	const res = await fetch("https://slack.com/api/auth.test", {
		method: "POST",
		headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(),
	});
	return res.json();
}

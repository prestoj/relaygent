#!/usr/bin/env node
/**
 * Slack OAuth token setup for relaygent.
 *
 * Run this once to get an xoxp- user token for the Slack MCP server.
 *
 * Prerequisites:
 *   1. Create a Slack app at https://api.slack.com/apps → "Create New App" → "From scratch"
 *   2. In "OAuth & Permissions" → "Redirect URLs", add: https://localhost:3333/callback
 *   3. In "OAuth & Permissions" → "User Token Scopes", add ALL of:
 *        channels:history  channels:read  channels:write
 *        chat:write
 *        groups:history  groups:read  groups:write
 *        im:history  im:read  im:write
 *        mpim:history  mpim:read  mpim:write
 *        reactions:write  search:read  users:read
 *   4. "Install to Workspace" (approve when prompted)
 *   5. Run: node slack/setup-token.mjs
 *
 * Usage:
 *   node slack/setup-token.mjs [--client-id ID --client-secret SECRET]
 *   node slack/setup-token.mjs --token xoxp-...   (manual paste, skips OAuth)
 */

import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { createInterface } from "readline";
import {
	CALLBACK_PORT, SCOPES, makeSelfSignedCert, openBrowser,
	saveToken, exchangeCode, verifyToken,
} from "./oauth-helpers.mjs";

const tlsCreds = makeSelfSignedCert();
const REDIRECT_URI = `${tlsCreds ? "https" : "http"}://localhost:${CALLBACK_PORT}/callback`;

function ask(rl, prompt) {
	return new Promise(resolve => rl.question(prompt, resolve));
}

async function runOAuthFlow(clientId, clientSecret) {
	return new Promise((resolve, reject) => {
		const handler = async (req, res) => {
			const url = new URL(req.url, `${tlsCreds ? "https" : "http"}://localhost:${CALLBACK_PORT}`);
			if (url.pathname !== "/callback") {
				res.writeHead(404); res.end("Not found"); return;
			}
			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");
			if (error) {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`<h2>Error: ${error}</h2><p>Close this tab.</p>`);
				server.close();
				reject(new Error(`OAuth denied: ${error}`));
				return;
			}
			if (!code) {
				res.writeHead(400); res.end("Missing code"); return;
			}
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<h2>✓ Authorized! You can close this tab.</h2>");
			server.close();

			console.log("\nExchanging code for token...");
			const data = await exchangeCode(clientId, clientSecret, code, REDIRECT_URI);
			if (!data.ok) { reject(new Error(`Token exchange failed: ${data.error}`)); return; }

			const token = data.authed_user?.access_token;
			if (!token) { reject(new Error("No user token in response")); return; }
			resolve(token);
		};
		const server = tlsCreds
			? createHttpsServer(tlsCreds, handler)
			: createHttpServer(handler);

		server.listen(CALLBACK_PORT, () => {
			const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
			console.log(`\nOpening browser for Slack authorization...`);
			if (tlsCreds) console.log("Note: browser may show an SSL warning — type 'thisisunsafe' to bypass.");
			console.log(`If browser doesn't open, visit:\n  ${authUrl}\n`);
			openBrowser(authUrl);
		});

		server.on("error", reject);
		setTimeout(() => { server.close(); reject(new Error("Timeout after 5 minutes")); }, 5 * 60 * 1000);
	});
}

async function main() {
	const args = process.argv.slice(2);
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	console.log("=== Relaygent Slack Token Setup ===\n");

	// --token flag: manual paste mode
	const tokenIdx = args.indexOf("--token");
	if (tokenIdx >= 0) {
		const token = args[tokenIdx + 1];
		if (!token) { console.error("--token requires a value"); process.exit(1); }
		const info = await verifyToken(token);
		if (!info.ok) { console.error("Token invalid:", info.error); process.exit(1); }
		console.log(`Token verified — user: ${info.user} (${info.user_id}), team: ${info.team}`);
		saveToken(token);
		rl.close();
		return;
	}

	// Get client_id
	let clientId = args[args.indexOf("--client-id") + 1] || "";
	if (!clientId) {
		console.log("You need a Slack app. Create one at https://api.slack.com/apps");
		console.log(`Then add redirect URI: ${REDIRECT_URI}`);
		console.log("And add the User Token Scopes listed in this file's header.\n");
		clientId = (await ask(rl, "Client ID: ")).trim();
	}

	// Get client_secret
	let clientSecret = args[args.indexOf("--client-secret") + 1] || "";
	if (!clientSecret) {
		clientSecret = (await ask(rl, "Client Secret: ")).trim();
	}

	rl.close();

	if (!clientId || !clientSecret) {
		console.error("client_id and client_secret are required");
		process.exit(1);
	}

	try {
		const token = await runOAuthFlow(clientId, clientSecret);
		const info = await verifyToken(token);
		if (info.ok) console.log(`Authorized as: ${info.user} (${info.user_id})`);
		saveToken(token);
		console.log("\nRestart the Slack MCP server to pick up the new token:");
		console.log("  pkill -f 'relaygent/slack/mcp-server.mjs'");
	} catch (err) {
		console.error("Failed:", err.message);
		process.exit(1);
	}
}

main().catch(e => { console.error(e); process.exit(1); });

// Setup helper functions extracted from setup.mjs to stay under 200 lines
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
export { setupHammerspoon } from './setup-hammerspoon.mjs';

export async function setupSecrets(REPO_DIR, C) {
	const { createVault, vaultExists } = await import(pathToFileURL(join(REPO_DIR, 'secrets', 'vault.mjs')).href);
	if (!vaultExists()) {
		createVault();
		console.log(`  Secrets: ${C.green}created${C.reset} (~/.relaygent/secrets.json, key: ~/.relaygent/master.key)`);
	} else {
		console.log(`  Secrets: ${C.green}exists${C.reset}`);
	}
}

export function setupHooks(config, REPO_DIR, HOME, C) {
	const hooksDir = join(REPO_DIR, 'hooks');
	const checkNotif = join(hooksDir, 'check-notifications');
	const projectHash = REPO_DIR.replace(/\//g, '-');
	const settingsDir = join(HOME, '.claude', 'projects', projectHash);
	mkdirSync(settingsDir, { recursive: true });
	const sessionStart = join(hooksDir, 'session-start');
	const truncateBash = join(hooksDir, 'truncate-bash-output');
	const settings = {
		env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "95" },
		hooks: {
			SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: sessionStart, timeout: 30 }] }],
			PostToolUse: [
				{ matcher: "*", hooks: [{ type: "command", command: checkNotif }] },
				{ matcher: "Bash", hooks: [{ type: "command", command: truncateBash }] },
			],
		},
	};
	writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
	writeFileSync(join(REPO_DIR, 'harness', 'settings.json'), JSON.stringify(settings, null, 2));
	console.log(`  Hooks: configured`);

	const claudeJson = join(HOME, '.claude.json');
	let claudeConfig = {};
	try { claudeConfig = JSON.parse(readFileSync(claudeJson, 'utf-8')); } catch { /* new file */ }
	if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};
	claudeConfig.mcpServers['hub-chat'] = {
		command: 'node',
		args: [join(REPO_DIR, 'hub', 'mcp-chat.mjs')],
		env: { HUB_PORT: String(config.hub.port) },
	};
	claudeConfig.mcpServers['relaygent-notifications'] = {
		command: 'node',
		args: [join(REPO_DIR, 'notifications', 'mcp-server.mjs')],
		env: { RELAYGENT_NOTIFICATIONS_PORT: String(config.services.notifications.port) },
	};
	claudeConfig.mcpServers['computer-use'] = {
		command: 'node',
		args: [join(REPO_DIR, 'computer-use', 'mcp-server.mjs')],
		env: { HAMMERSPOON_PORT: String(config.services?.hammerspoon?.port || 8097) },
	};
	for (const name of ['secrets', 'email', 'slack', 'linear']) {
		claudeConfig.mcpServers[name] = { command: 'node', args: [join(REPO_DIR, name, 'mcp-server.mjs')] };
	}
	writeFileSync(claudeJson, JSON.stringify(claudeConfig, null, 2));
	console.log(`  MCP: hub-chat + notifications + computer-use + secrets + email + slack + linear registered`);
}

export async function setupSlackToken(REPO_DIR, HOME, C) {
	const tokenPath = join(HOME, '.relaygent', 'slack', 'token.json');
	const appTokenPath = join(HOME, '.relaygent', 'slack', 'app-token');
	const { existsSync } = await import('fs');
	const setupScript = join(REPO_DIR, 'slack', 'setup-token.mjs');

	// User token (xoxp-*) — reading messages / channel history
	if (existsSync(tokenPath)) {
		try {
			const { access_token } = JSON.parse(readFileSync(tokenPath, 'utf-8'));
			const res = await fetch('https://slack.com/api/auth.test', {
				method: 'POST',
				headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams(),
			});
			const data = await res.json();
			if (data.ok) {
				console.log(`  Slack user token: ${C.green}valid${C.reset} (${data.user} in ${data.team})`);
			} else {
				console.log(`  Slack user token: ${C.yellow}invalid — re-run: node ${setupScript}${C.reset}`);
			}
		} catch { console.log(`  Slack user token: ${C.yellow}unreadable${C.reset}`); }
	} else {
		console.log(`  Slack user token: ${C.yellow}not set up${C.reset}`);
		console.log(`  Run: ${C.bold}node ${setupScript} --token xoxp-...${C.reset} ${C.dim}(or full OAuth: node ${setupScript})${C.reset}`);
	}

	// App-level token (xapp-*) — Socket Mode real-time delivery
	if (existsSync(appTokenPath) && readFileSync(appTokenPath, 'utf-8').trim().startsWith('xapp-')) {
		console.log(`  Slack app token: ${C.green}present${C.reset} (Socket Mode enabled)`);
	} else {
		console.log(`  Slack app token: ${C.yellow}not set up${C.reset} — real-time messages require Socket Mode`);
		console.log(`  ${C.dim}Slack app → Basic Information → App-Level Tokens → create with connections:write${C.reset}`);
		console.log(`  ${C.dim}Then: echo 'xapp-...' > ${appTokenPath}${C.reset}`);
	}
}

export function envFromConfig(config) {
	return {
		RELAYGENT_HUB_PORT: String(config.hub.port),
		RELAYGENT_DATA_DIR: config.paths.data,
		RELAYGENT_KB_DIR: config.paths.kb,
	};
}

export function setupClaudeMd(HOME, config, REPO_DIR, C) {
	const claudeMdPath = join(HOME, 'CLAUDE.md');
	if (existsSync(claudeMdPath)) { console.log(`  CLAUDE.md: ${C.green}exists${C.reset}`); return; }
	const user = HOME.split('/').pop();
	const [kb, data, repo] = [config.paths.kb, config.paths.data, REPO_DIR].map(p => p.replace(HOME, '~'));
	const host = hostname();
	const hsPort = config.services?.hammerspoon?.port || 8097;
	const vars = { HOST: host, PLATFORM: process.platform, USER: user, HOME, REPO: repo, KB: kb, DATA: data,
		HUB_PORT: config.hub.port, NOTIF_PORT: config.services.notifications.port, HS_PORT: hsPort };
	let content = readFileSync(join(REPO_DIR, 'templates', 'CLAUDE.md'), 'utf-8');
	for (const [k, v] of Object.entries(vars)) content = content.replaceAll(`{{${k}}}`, v);
	writeFileSync(claudeMdPath, content);
	console.log(`  CLAUDE.md: ${C.green}created${C.reset} (${claudeMdPath})`);
}

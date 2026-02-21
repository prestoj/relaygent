// Setup helper functions extracted from setup.mjs to stay under 200 lines
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

export async function setupSecrets(REPO_DIR, C) {
	const { createVault, vaultExists } = await import(pathToFileURL(join(REPO_DIR, 'secrets', 'vault.mjs')).href);
	if (!vaultExists()) {
		createVault();
		console.log(`  Secrets: ${C.green}created${C.reset} (~/.relaygent/secrets.json, key: ~/.relaygent/master.key)`);
	} else {
		console.log(`  Secrets: ${C.green}exists${C.reset}`);
	}
}

export function setupHammerspoon(config, REPO_DIR, HOME, C, ask) {
	if (process.platform !== 'darwin') {
		console.log(`  Computer-use: ${C.yellow}Linux detected${C.reset} — uses python linux-server.py (started automatically)`);
		console.log(`  ${C.dim}Debian/Ubuntu: sudo apt install xdotool scrot wmctrl imagemagick at-spi2-core python3-pyatspi gir1.2-atspi-2.0${C.reset}`);
		return;
	}
	const hsDir = join(HOME, '.hammerspoon');
	const srcDir = join(REPO_DIR, 'hammerspoon');
	mkdirSync(hsDir, { recursive: true });
	for (const f of ['init.lua', 'input_handlers.lua', 'ax_handler.lua', 'ax_press.lua']) {
		copyFileSync(join(srcDir, f), join(hsDir, f));
	}
	console.log(`  Hammerspoon: lua files installed to ${hsDir}`);

	const hs = spawnSync('open', ['-Ra', 'Hammerspoon'], { stdio: 'pipe' });
	if (hs.status === 0) {
		console.log(`  Hammerspoon: ${C.green}found${C.reset}`);
		showPermissionGuide(C);
		return;
	}
	// Not installed — try to install via brew
	const brew = spawnSync('which', ['brew'], { stdio: 'pipe' });
	if (brew.status !== 0) {
		console.log(`  ${C.yellow}Hammerspoon not installed and Homebrew not found.${C.reset}`);
		console.log(`  ${C.yellow}Install manually: https://www.hammerspoon.org/${C.reset}`);
		showPermissionGuide(C);
		return;
	}
	console.log(`  ${C.yellow}Hammerspoon not installed. Computer-use (screenshot, click, type) requires it.${C.reset}`);
	return installHammerspoon(C, ask);
}

async function installHammerspoon(C, ask) {
	const answer = (await ask(`  ${C.cyan}Install Hammerspoon now? [Y/n]:${C.reset} `)).trim().toLowerCase();
	if (answer === 'n') {
		console.log(`  ${C.dim}Skipped. Install later: brew install --cask hammerspoon${C.reset}`);
		return;
	}
	console.log(`  Installing Hammerspoon...`);
	const res = spawnSync('brew', ['install', '--cask', 'hammerspoon'], { stdio: 'inherit' });
	if (res.status === 0) {
		console.log(`  Hammerspoon: ${C.green}installed${C.reset}`);
		console.log(`  Launching Hammerspoon...`);
		spawnSync('open', ['-a', 'Hammerspoon'], { stdio: 'pipe' });
	} else {
		console.log(`  ${C.red}Install failed. Try manually: brew install --cask hammerspoon${C.reset}`);
	}
	showPermissionGuide(C);
}

function showPermissionGuide(C) {
	console.log('');
	console.log(`  ${C.yellow}┌─ Hammerspoon Permissions ────────────────────────────────────┐${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  Hammerspoon is how your agent interacts with the screen.    ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  It needs two macOS permissions to take screenshots,         ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  click buttons, and type text on your behalf.                ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}                                                              ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  Go to ${C.bold}System Settings > Privacy & Security${C.reset} and grant:       ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}    1. ${C.bold}Accessibility${C.reset} — lets the agent click and type          ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}    2. ${C.bold}Screen Recording${C.reset} — lets the agent see your screen      ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}                                                              ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  Without these, computer-use tools won't work.               ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}└──────────────────────────────────────────────────────────────┘${C.reset}`);
	console.log('');
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

#!/usr/bin/env node
/**
 * Relaygent interactive setup TUI.
 * Walks a new user through configuration and first launch.
 */
import { createInterface } from 'readline';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { setupHammerspoon, setupHooks, setupSecrets, setupSlackToken, setupClaudeMd, envFromConfig } from './setup-helpers.mjs';
import { checkPortConflict, printSetupComplete, setupCliSymlink, checkPrerequisites, copyKbTemplates, initKbGit, installDeps } from './setup-utils.mjs';

const REPO_DIR = process.argv[2] || resolve('.');
const HOME = homedir();
const CONFIG_DIR = join(HOME, '.relaygent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const KB_DIR = join(REPO_DIR, 'knowledge', 'topics');
const LOGS_DIR = join(REPO_DIR, 'logs');
const DATA_DIR = join(REPO_DIR, 'data');

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));
const openBrowser = (url) => { const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'; spawnSync(cmd, [url], { stdio: 'ignore' }); };

async function main() {
	checkPrerequisites(C);
	console.log(`Sets up a persistent AI agent with a web dashboard.\n`);

	const agentName = 'relaygent'; const hubPort = 8080; const notifPort = 8083;
	await checkPortConflict(hubPort, C);
	await checkPortConflict(notifPort, C);

	console.log(`${C.yellow}Setting up directories...${C.reset}`);
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(KB_DIR, { recursive: true });
	mkdirSync(LOGS_DIR, { recursive: true });
	mkdirSync(DATA_DIR, { recursive: true });
	const config = {
		agent: { name: agentName },
		hub: { port: hubPort },
		services: { notifications: { port: hubPort + 3 }, hammerspoon: { port: hubPort + 17 } },
		paths: { repo: REPO_DIR, kb: KB_DIR, logs: LOGS_DIR, data: DATA_DIR },
		created: new Date().toISOString(),
	};
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
	console.log(`  Config: ${CONFIG_FILE}`);

	const { today, kbRoot } = copyKbTemplates(REPO_DIR, KB_DIR, C);

	// Prompt for initial intent so the agent knows what to work on
	const intentFile = join(KB_DIR, 'INTENT.md');
	if (readFileSync(intentFile, 'utf-8').includes('Delete everything above')) {
		console.log(`\n${C.cyan}What should your agent focus on?${C.reset}\n${C.dim}Examples: "Build a blog", "Maintain my server", "Help with code reviews"${C.reset}`);
		const intent = (await ask(`${C.cyan}Intent (Enter to skip): ${C.reset}`)).trim();
		if (intent) {
			writeFileSync(intentFile, `---\ntitle: Intent\ncreated: ${today}\nupdated: ${today}\ntags: [meta, intent]\n---\n\n${intent}\n`);
			console.log(`  ${C.green}Intent saved${C.reset}`);
		} else console.log(`  ${C.dim}Skipped — edit INTENT.md later${C.reset}`);
	}

	initKbGit(kbRoot, agentName, REPO_DIR, C);
	installDeps(REPO_DIR, DATA_DIR, C);
	setupClaudeMd(HOME, config, REPO_DIR, C);
	await setupSecrets(REPO_DIR, C);
	await setupSlackToken(REPO_DIR, HOME, C);
	await setupHammerspoon(config, REPO_DIR, HOME, C, ask);
	setupHooks(config, REPO_DIR, HOME, C);
	setupCliSymlink(REPO_DIR, HOME, C);

	// Offer auto-restart service installation
	let servicesInstalled = false;
	const serviceScript = process.platform === 'darwin'
		? join(REPO_DIR, 'scripts', 'install-launchagents.sh')
		: join(REPO_DIR, 'scripts', 'install-systemd-services.sh');
	const serviceLabel = process.platform === 'darwin' ? 'LaunchAgents' : 'systemd services';
	const svc = (await ask(`\n${C.cyan}Install auto-restart services (${serviceLabel})? [Y/n]:${C.reset} `)).trim().toLowerCase();
	if (svc !== 'n') { spawnSync('bash', [serviceScript], { stdio: 'inherit' }); servicesInstalled = true; }
	printSetupComplete(hubPort, C);
	if (!servicesInstalled) {
		const launch = (await ask(`${C.cyan}Launch now? [Y/n]:${C.reset} `)).trim().toLowerCase();
		if (launch !== 'n') {
			console.log(`\nStarting Relaygent...\n`);
			spawnSync(join(REPO_DIR, 'bin', 'relaygent'), ['start'],
				{ stdio: 'inherit', env: { ...process.env, ...envFromConfig(config) } });
		}
	}
	console.log(`\n${C.cyan}Verifying installation...${C.reset}\n`);
	spawnSync('bash', [join(REPO_DIR, 'harness', 'scripts', 'check.sh')], { stdio: 'inherit' });
	const hubUrl = `http://localhost:${hubPort}/`;
	console.log(`\nOpening hub: ${hubUrl}`); openBrowser(hubUrl);
	rl.close();
}

main().catch(e => { console.error(`${C.red}Setup failed: ${e.message}${C.reset}`); rl.close(); process.exit(1); });

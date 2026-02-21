#!/usr/bin/env node
/**
 * Relaygent interactive setup TUI.
 * Walks a new user through configuration and first launch.
 */
import { createInterface } from 'readline';
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { setupHammerspoon, setupHooks, setupSecrets, setupSlackToken, setupClaudeMd, envFromConfig } from './setup-helpers.mjs';
import { checkPortConflict, printSetupComplete, setupCliSymlink } from './setup-utils.mjs';

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
	// Step 0: Prerequisites
	if (spawnSync('git', ['--version'], { stdio: 'pipe' }).status !== 0) {
		console.log(`${C.red}git required. Install git and re-run setup.${C.reset}`); process.exit(1);
	}
	const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
	if (nodeMajor < 20) console.log(`${C.yellow}Warning: Node.js ${process.versions.node} detected; v20+ recommended.${C.reset}`);
	// Claude Code — must be installed and authenticated before anything else
	if (spawnSync('claude', ['--version'], { stdio: 'pipe' }).status !== 0) {
		console.log(`${C.red}Claude Code required. Install: ${C.bold}npm install -g @anthropic-ai/claude-code${C.reset}`);
		console.log(`Then run ${C.bold}claude${C.reset} to log in, then ${C.bold}./setup.sh${C.reset} again.`);
		process.exit(1);
	}
	const claudeVer = spawnSync('claude', ['--version'], { stdio: 'pipe' });
	console.log(`${C.green}Claude Code found: ${claudeVer.stdout.toString().trim()}${C.reset}`);
	console.log(`  ${C.dim}Checking Claude auth (may take a few seconds)...${C.reset}`);
	if (spawnSync('claude', ['-p', 'hi'], { stdio: 'pipe', timeout: 15000 }).status !== 0) {
		console.log(`${C.red}Claude Code not logged in. Run ${C.bold}claude${C.reset}${C.red} first.${C.reset}`);
		process.exit(1);
	}
	console.log(`${C.green}Claude Code authenticated.${C.reset}\n`);
	console.log(`Sets up a persistent AI agent with a web dashboard.\n`);

	const agentName = 'relaygent'; const hubPort = 8080;
	await checkPortConflict(hubPort, C);
	// Write config
	console.log(`${C.yellow}Setting up directories...${C.reset}`);
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(KB_DIR, { recursive: true });
	mkdirSync(LOGS_DIR, { recursive: true });
	mkdirSync(DATA_DIR, { recursive: true });
	const config = {
		agent: { name: agentName },
		hub: { port: hubPort },
		services: {
			notifications: { port: hubPort + 3 },
			hammerspoon: { port: hubPort + 17 },
		},
		paths: { repo: REPO_DIR, kb: KB_DIR, logs: LOGS_DIR, data: DATA_DIR },
		created: new Date().toISOString(),
	};
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
	console.log(`  Config: ${CONFIG_FILE}`);

	// Copy KB templates
	const templatesDir = join(REPO_DIR, 'templates');
	const today = new Date().toISOString().split('T')[0];
	for (const f of ['HANDOFF.md', 'INTENT.md', 'tasks.md', 'curiosities.md', 'relay.md', 'projects.md', 'MEMORY.md']) {
		const dest = join(KB_DIR, f);
		if (!existsSync(dest)) {
			let content = readFileSync(join(templatesDir, f), 'utf-8');
			content = content.replace(/YYYY-MM-DD/g, today);
			writeFileSync(dest, content);
		}
	}
	const kbRoot = join(REPO_DIR, 'knowledge');
	const commitSh = join(kbRoot, 'commit.sh');
	if (!existsSync(commitSh)) {
		copyFileSync(join(templatesDir, 'commit.sh'), commitSh);
		chmodSync(commitSh, 0o755);
	}
	console.log(`  KB templates: ${KB_DIR}`);

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

	// Init git for KB (use spawnSync to avoid shell injection from user input)
	if (!existsSync(join(kbRoot, '.git'))) {
		const gitOpts = { cwd: kbRoot, stdio: 'pipe' };
		spawnSync('git', ['init'], gitOpts);
		spawnSync('git', ['config', 'user.name', agentName], gitOpts);
		spawnSync('git', ['config', 'user.email', `${agentName}@localhost`], gitOpts);
		spawnSync('git', ['add', '-A'], gitOpts);
		spawnSync('git', ['commit', '-m', 'Initial KB'], gitOpts);
		console.log(`  KB git: initialized`);
	}

	// Set up pre-commit hook for 200-line enforcement
	try {
		execSync('git config core.hooksPath scripts', { cwd: REPO_DIR, stdio: 'pipe' });
		console.log(`  Git hooks: ${C.green}200-line pre-commit enabled${C.reset}`);
	} catch { /* not a git repo yet, skip */ }

	// Install Node.js dependencies
	for (const sub of ['hub', 'notifications', 'computer-use', 'email', 'slack', 'secrets']) {
		console.log(`  Installing ${sub} dependencies...`);
		try {
			execSync('npm install', { cwd: join(REPO_DIR, sub), stdio: 'pipe' });
			console.log(`  ${sub}: ${C.green}deps installed${C.reset}`);
		} catch (e) {
			console.log(`  ${sub}: ${C.red}npm install failed${C.reset} — ${e.stderr?.toString().trim() || e.message}`);
			console.log(`  ${C.red}Fix the error above and re-run setup.${C.reset}`);
			rl.close(); process.exit(1);
		}
	}
	for (const sub of ['notifications']) {
		const dir = join(REPO_DIR, sub);
		const venv = join(dir, '.venv');
		console.log(`  Setting up ${sub} Python venv...`);
		try {
			execSync(`python3 -m venv "${venv}" && "${venv}/bin/pip" install -q -r requirements.txt`,
				{ cwd: dir, stdio: 'pipe' });
			console.log(`  ${sub}: ${C.green}venv ready${C.reset}`);
		} catch {
			console.log(`  ${sub}: ${C.red}venv failed${C.reset}. Debian/Ubuntu: sudo apt install python3-venv`);
			console.log(`  ${C.red}Cannot continue without ${sub}. Fix the error above and re-run setup.${C.reset}`);
			rl.close(); process.exit(1);
		}
	}
	console.log(`  Building hub...`);
	try {
		execSync('npm run build', { cwd: join(REPO_DIR, 'hub'), stdio: 'pipe' });
		const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR, stdio: 'pipe' }).stdout?.toString().trim() || '';
		if (head) writeFileSync(join(DATA_DIR, 'hub-build-commit'), head);
		console.log(`  Hub: ${C.green}built${C.reset}`);
	} catch (e) {
		console.log(`  Hub: ${C.red}build failed${C.reset} — ${e.stderr?.toString().trim() || e.message}`);
		console.log(`  ${C.red}Fix the error above and re-run setup.${C.reset}`);
		rl.close(); process.exit(1);
	}
	setupClaudeMd(HOME, config, REPO_DIR, C);
	// Create secrets file and store credentials
	await setupSecrets(REPO_DIR, C);

	// Check Slack token
	await setupSlackToken(REPO_DIR, HOME, C);

	// Set up Hammerspoon (computer-use)
	await setupHammerspoon(config, REPO_DIR, HOME, C, ask);

	// Set up Claude CLI hooks + MCP servers
	setupHooks(config, REPO_DIR, HOME, C);

	setupCliSymlink(REPO_DIR, HOME, C);
	// Offer auto-restart service installation (LaunchAgents on macOS, systemd on Linux)
	let servicesInstalled = false;
	const serviceScript = process.platform === 'darwin'
		? join(REPO_DIR, 'scripts', 'install-launchagents.sh')
		: join(REPO_DIR, 'scripts', 'install-systemd-services.sh');
	const serviceLabel = process.platform === 'darwin' ? 'LaunchAgents' : 'systemd services';
	const svc = (await ask(`\n${C.cyan}Install auto-restart services (${serviceLabel})? [Y/n]:${C.reset} `)).trim().toLowerCase();
	if (svc !== 'n') {
		spawnSync('bash', [serviceScript], { stdio: 'inherit' });
		servicesInstalled = true;
	}
	printSetupComplete(hubPort, C);
	if (!servicesInstalled) {
		const launch = (await ask(`${C.cyan}Launch now? [Y/n]:${C.reset} `)).trim().toLowerCase();
		if (launch !== 'n') {
			console.log(`\nStarting Relaygent...\n`);
			spawnSync(join(REPO_DIR, 'bin', 'relaygent'), ['start'],
				{ stdio: 'inherit', env: { ...process.env, ...envFromConfig(config) } });
		}
	}
	// Post-setup verification
	console.log(`\n${C.cyan}Verifying installation...${C.reset}\n`);
	spawnSync('bash', [join(REPO_DIR, 'harness', 'scripts', 'check.sh')], { stdio: 'inherit' });

	const hubUrl = `http://localhost:${hubPort}/`;
	console.log(`\nOpening hub: ${hubUrl}`); openBrowser(hubUrl);
	rl.close();
}

main().catch(e => { console.error(`${C.red}Setup failed: ${e.message}${C.reset}`); process.exit(1); });

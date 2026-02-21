// Setup utility functions extracted from setup.mjs to stay under 200 lines.
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync, appendFileSync } from 'fs';
import { join } from 'path';

export async function checkPortConflict(port, C) {
	const { createServer } = await import('net');
	const inUse = await new Promise(resolve => {
		const s = createServer();
		s.once('error', e => resolve(e.code === 'EADDRINUSE'));
		s.once('listening', () => { s.close(); resolve(false); });
		s.listen(port, '127.0.0.1');
	});
	if (inUse) {
		console.log(`${C.red}Port ${port} is already in use. Stop the existing service and re-run setup.${C.reset}`);
		process.exit(1);
	}
}

export function printSetupComplete(hubPort, C) {
	const url = `http://localhost:${hubPort}/`;
	console.log(`\n${C.green}┌─ Setup complete! ──────────────────────────────────────────┐${C.reset}`);
	console.log(`${C.green}│${C.reset}  Dashboard:  ${C.bold}${url}${C.reset}`);
	console.log(`${C.green}│${C.reset}  Commands:   ${C.bold}relaygent start / stop / status / restart${C.reset}`);
	console.log(`${C.green}│${C.reset}  Health:     ${C.bold}relaygent health${C.reset}  (verify everything works)`);
	console.log(`${C.green}│${C.reset}  Orient:     ${C.bold}relaygent orient${C.reset}  (quick status snapshot)`);
	console.log(`${C.green}│${C.reset}`);
	console.log(`${C.green}│${C.reset}  ${C.yellow}Next steps:${C.reset}`);
	console.log(`${C.green}│${C.reset}  1. Edit ${C.bold}knowledge/topics/INTENT.md${C.reset} with your priorities`);
	console.log(`${C.green}│${C.reset}  2. Run ${C.bold}relaygent health${C.reset} to verify services are running`);
	console.log(`${C.green}│${C.reset}  3. Your agent will greet you in hub chat after launching`);
	console.log(`${C.green}│${C.reset}`);
	console.log(`${C.green}│${C.reset}  ${C.dim}Docs: https://relaygent.ai/docs.html${C.reset}`);
	console.log(`${C.green}└────────────────────────────────────────────────────────────┘${C.reset}\n`);
}

export function setupCliSymlink(REPO_DIR, HOME, C) {
	const cliSrc = join(REPO_DIR, 'bin', 'relaygent');
	const userBin = join(HOME, 'bin');
	let cliOk = false;
	try {
		mkdirSync(userBin, { recursive: true });
		execSync(`ln -sf "${cliSrc}" "${join(userBin, 'relaygent')}"`, { stdio: 'pipe' });
		console.log(`  CLI: ${C.green}relaygent${C.reset} command available (~/bin)`);
		cliOk = true;
	} catch { /* ~/bin not writable */ }
	if (!cliOk) {
		try {
			execSync(`ln -sf "${cliSrc}" "/usr/local/bin/relaygent"`, { stdio: 'pipe' });
			console.log(`  CLI: ${C.green}relaygent${C.reset} command available (/usr/local/bin)`);
			cliOk = true;
		} catch { /* no write access to /usr/local/bin */ }
	}
	if (!cliOk) {
		const binDir = join(REPO_DIR, 'bin');
		const rcFile = join(HOME, process.env.SHELL?.includes('zsh') ? '.zshrc' : '.bashrc');
		const pathLine = `export PATH="${binDir}:$PATH"  # relaygent`;
		try {
			const rc = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';
			if (!rc.includes(binDir)) {
				appendFileSync(rcFile, `\n${pathLine}\n`);
				console.log(`  CLI: added ${binDir} to PATH in ${rcFile}`);
				console.log(`  ${C.yellow}Restart your shell or run: source ${rcFile}${C.reset}`);
			}
		} catch {
			console.log(`  CLI: add ${binDir} to your PATH manually`);
		}
	}
}

export function checkPrerequisites(C) {
	if (spawnSync('git', ['--version'], { stdio: 'pipe' }).status !== 0) {
		throw new Error('git required. Install git and re-run setup.');
	}
	const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
	if (nodeMajor < 20) console.log(`${C.yellow}Warning: Node.js ${process.versions.node} detected; v20+ recommended.${C.reset}`);
	if (spawnSync('claude', ['--version'], { stdio: 'pipe' }).status !== 0) {
		throw new Error(`Claude Code required. Install: npm install -g @anthropic-ai/claude-code`);
	}
	const ver = spawnSync('claude', ['--version'], { stdio: 'pipe' }).stdout.toString().trim();
	console.log(`${C.green}Claude Code found: ${ver}${C.reset}`);
	console.log(`  ${C.dim}Checking Claude auth (may take a few seconds)...${C.reset}`);
	if (spawnSync('claude', ['-p', 'hi'], { stdio: 'pipe', timeout: 15000 }).status !== 0) {
		throw new Error('Claude Code not logged in. Run claude first.');
	}
	console.log(`${C.green}Claude Code authenticated.${C.reset}\n`);
}

export function copyKbTemplates(REPO_DIR, KB_DIR, C) {
	const templatesDir = join(REPO_DIR, 'templates');
	const today = new Date().toISOString().split('T')[0];
	for (const f of ['HANDOFF.md', 'INTENT.md', 'tasks.md', 'curiosities.md', 'relay.md', 'projects.md', 'MEMORY.md']) {
		const dest = join(KB_DIR, f);
		if (!existsSync(dest)) {
			let content = readFileSync(join(templatesDir, f), 'utf-8');
			writeFileSync(dest, content.replace(/YYYY-MM-DD/g, today));
		}
	}
	const kbRoot = join(REPO_DIR, 'knowledge');
	const commitSh = join(kbRoot, 'commit.sh');
	if (!existsSync(commitSh)) { copyFileSync(join(templatesDir, 'commit.sh'), commitSh); chmodSync(commitSh, 0o755); }
	console.log(`  KB templates: ${KB_DIR}`);
	return { today, kbRoot };
}

export function initKbGit(kbRoot, agentName, REPO_DIR, C) {
	if (!existsSync(join(kbRoot, '.git'))) {
		const o = { cwd: kbRoot, stdio: 'pipe' };
		spawnSync('git', ['init'], o);
		spawnSync('git', ['config', 'user.name', agentName], o);
		spawnSync('git', ['config', 'user.email', `${agentName}@localhost`], o);
		spawnSync('git', ['add', '-A'], o);
		spawnSync('git', ['commit', '-m', 'Initial KB'], o);
		console.log(`  KB git: initialized`);
	}
	try { execSync('git config core.hooksPath scripts', { cwd: REPO_DIR, stdio: 'pipe' }); console.log(`  Git hooks: ${C.green}200-line pre-commit enabled${C.reset}`); } catch { /* skip */ }
}

export function installDeps(REPO_DIR, DATA_DIR, C) {
	for (const sub of ['hub', 'notifications', 'computer-use', 'email', 'slack', 'secrets']) {
		console.log(`  Installing ${sub} dependencies...`);
		try { execSync('npm install', { cwd: join(REPO_DIR, sub), stdio: 'pipe' }); console.log(`  ${sub}: ${C.green}deps installed${C.reset}`); }
		catch (e) { throw new Error(`${sub}: npm install failed — ${e.stderr?.toString().trim() || e.message}`); }
	}
	const nDir = join(REPO_DIR, 'notifications'), venv = join(nDir, '.venv');
	console.log(`  Setting up notifications Python venv...`);
	try { execSync(`python3 -m venv "${venv}" && "${venv}/bin/pip" install -q -r requirements.txt`, { cwd: nDir, stdio: 'pipe' }); console.log(`  notifications: ${C.green}venv ready${C.reset}`); }
	catch { throw new Error('notifications: venv failed. Debian/Ubuntu: sudo apt install python3-venv'); }
	console.log(`  Building hub...`);
	try {
		execSync('npm run build', { cwd: join(REPO_DIR, 'hub'), stdio: 'pipe' });
		const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR, stdio: 'pipe' }).stdout?.toString().trim() || '';
		if (head) writeFileSync(join(DATA_DIR, 'hub-build-commit'), head);
		console.log(`  Hub: ${C.green}built${C.reset}`);
	} catch (e) { throw new Error(`Hub build failed — ${e.stderr?.toString().trim() || e.message}`); }
}

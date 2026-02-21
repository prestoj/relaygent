// Setup utility functions: port conflict check, completion display, CLI symlink.
import { execSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';
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

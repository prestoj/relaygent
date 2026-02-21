// Hammerspoon setup for macOS computer-use
import { spawnSync } from 'child_process';
import { mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

export async function setupHammerspoon(config, REPO_DIR, HOME, C, ask) {
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
	const brew = spawnSync('which', ['brew'], { stdio: 'pipe' });
	if (brew.status !== 0) {
		console.log(`  ${C.yellow}Hammerspoon not installed and Homebrew not found.${C.reset}`);
		console.log(`  ${C.yellow}Install manually: https://www.hammerspoon.org/${C.reset}`);
		showPermissionGuide(C);
		return;
	}
	console.log(`  ${C.yellow}Hammerspoon not installed. Computer-use (screenshot, click, type) requires it.${C.reset}`);
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

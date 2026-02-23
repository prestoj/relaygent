/**
 * VNC server setup for relaygent.
 * macOS: enables Remote Management with VNC password auth.
 * Linux: configures x11vnc with password file.
 */
import { spawnSync, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { randomBytes } from 'crypto';

const CONFIG_FILE = join(homedir(), '.relaygent', 'config.json');

function generatePassword() {
	return randomBytes(4).toString('hex'); // 8-char hex password (VNC max is 8)
}

function setupMacVnc(password, C) {
	console.log(`  ${C.dim}Enabling Remote Management + VNC auth...${C.reset}`);
	const kickstart = '/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart';
	const result = spawnSync('sudo', [kickstart,
		'-activate', '-configure', '-access', '-on',
		'-clientopts', '-setvnclegacy', '-vnclegacy', 'yes',
		'-setvncpw', '-vncpw', password,
		'-restart', '-agent', '-privs', '-all',
		'-allowAccessFor', '-allUsers',
	], { timeout: 30000, stdio: ['inherit', 'pipe', 'pipe'] });
	if (result.status !== 0) {
		console.log(`  ${C.yellow}Warning: kickstart failed (may need GUI approval)${C.reset}`);
		return false;
	}
	console.log(`  ${C.green}macOS VNC enabled on :5900${C.reset}`);
	return true;
}

function setupLinuxVnc(password, C) {
	// Check if x11vnc is installed
	const which = spawnSync('which', ['x11vnc'], { stdio: 'pipe' });
	if (which.status !== 0) {
		console.log(`  ${C.dim}Installing x11vnc...${C.reset}`);
		spawnSync('sudo', ['apt-get', 'install', '-y', 'x11vnc'], { stdio: 'inherit', timeout: 60000 });
	}
	// Write password file
	const pwFile = join(homedir(), '.relaygent', 'vnc-passwd');
	spawnSync('x11vnc', ['-storepasswd', password, pwFile], { stdio: 'pipe' });
	console.log(`  ${C.green}Linux VNC configured (x11vnc)${C.reset}`);
	return true;
}

/** Set up VNC server and add config. Returns the VNC password. */
export function setupVnc(config, C) {
	console.log(`\n${C.yellow}Setting up VNC server...${C.reset}`);
	const password = generatePassword();
	const isMac = platform() === 'darwin';
	const ok = isMac ? setupMacVnc(password, C) : setupLinuxVnc(password, C);

	if (ok) {
		// Add VNC config
		config.vnc = { password, port: 5900 };
		try {
			writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
			console.log(`  ${C.dim}VNC password saved to config${C.reset}`);
		} catch {}
	}
	return password;
}

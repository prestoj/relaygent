/**
 * Remote access setup — TLS via Tailscale + optional hub password.
 * Called during setup wizard to configure secure remote access.
 */
import { spawnSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';

function configPath() { return join(homedir(), '.relaygent', 'config.json'); }

export async function setupRemote(config, REPO_DIR, C, ask) {
	console.log(`\n${C.cyan}Remote Access${C.reset}`);
	console.log(`${C.dim}Access your hub from other devices (phone, laptop, tablet)${C.reset}`);
	const answer = (await ask(`\n${C.cyan}Set up remote access? [Y/n]: ${C.reset}`)).trim().toLowerCase();
	if (answer === 'n') {
		console.log(`  ${C.dim}Skipped — run 'relaygent setup-tls' later${C.reset}`);
		return;
	}

	// Check Tailscale
	const hasTailscale = spawnSync('tailscale', ['--version'], { stdio: 'pipe' }).status === 0;
	if (!hasTailscale) {
		console.log(`  ${C.yellow}Tailscale not found.${C.reset} Recommended for secure remote access.`);
		console.log(`  Install: ${C.bold}https://tailscale.com/download${C.reset}`);
		console.log(`  ${C.dim}After installing, run: relaygent setup-tls${C.reset}`);
	} else {
		setupTls(config, C);
	}

	// Hub password (useful with or without TLS)
	await setupPassword(config, REPO_DIR, C, ask);

	// Save updated config
	try {
		writeFileSync(configPath(), JSON.stringify(config, null, 2));
	} catch {}

	// Print result
	const scheme = config.hub?.tls ? 'https' : 'http';
	const host = config.hub?.tls?.hostname || 'localhost';
	const port = config.hub?.port || 8080;
	if (config.hub?.tls) {
		console.log(`\n  ${C.green}Remote access ready!${C.reset}`);
		console.log(`  URL: ${C.bold}${scheme}://${host}:${port}/${C.reset}`);
	}
}

function setupTls(config, C) {
	let tsHostname = '';
	try {
		const result = spawnSync('tailscale', ['status', '--self', '--json'], { stdio: 'pipe' });
		const data = JSON.parse(result.stdout.toString());
		tsHostname = data.Self.DNSName.replace(/\.$/, '');
	} catch {}

	if (!tsHostname) {
		console.log(`  Tailscale: ${C.yellow}not connected${C.reset} — run 'tailscale up' first`);
		console.log(`  ${C.dim}Then run: relaygent setup-tls${C.reset}`);
		return;
	}
	console.log(`  Tailscale: ${C.green}${tsHostname}${C.reset}`);

	const certDir = join(homedir(), '.relaygent', 'certs');
	mkdirSync(certDir, { recursive: true });
	console.log(`  Generating TLS certificate...`);
	const certResult = spawnSync('tailscale', ['cert',
		'--cert-file', join(certDir, 'cert.pem'),
		'--key-file', join(certDir, 'key.pem'),
		tsHostname,
	], { stdio: 'pipe' });

	if (certResult.status === 0) {
		spawnSync('chmod', ['600', join(certDir, 'key.pem')]);
		config.hub = config.hub || {};
		config.hub.tls = {
			cert: join(certDir, 'cert.pem'),
			key: join(certDir, 'key.pem'),
			hostname: tsHostname,
		};
		console.log(`  TLS: ${C.green}configured${C.reset}`);
	} else {
		console.log(`  TLS: ${C.yellow}cert generation failed${C.reset}`);
		console.log(`  ${C.dim}Enable HTTPS in Tailscale admin: DNS → Enable HTTPS${C.reset}`);
	}
}

async function setupPassword(config, REPO_DIR, C, ask) {
	const label = config.hub?.tls ? '(recommended)' : '(recommended for remote access)';
	const pwAnswer = (await ask(`\n${C.cyan}Set a hub password? ${label} [Y/n]: ${C.reset}`)).trim().toLowerCase();
	if (pwAnswer === 'n') return;

	const pw = await ask(`  Password (min 4 chars): `);
	if (!pw || pw.length < 4) {
		console.log(`  ${C.yellow}Too short — skipped. Run 'relaygent set-password' later.${C.reset}`);
		return;
	}
	const pw2 = await ask(`  Confirm: `);
	if (pw !== pw2) {
		console.log(`  ${C.yellow}Didn't match — skipped. Run 'relaygent set-password' later.${C.reset}`);
		return;
	}
	const { hashPassword } = await import(pathToFileURL(join(REPO_DIR, 'hub', 'src', 'lib', 'auth.js')).href);
	config.hub = config.hub || {};
	config.hub.passwordHash = hashPassword(pw);
	delete config.hub.sessionSecret;
	console.log(`  Password: ${C.green}set${C.reset}`);
}

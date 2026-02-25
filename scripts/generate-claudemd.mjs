#!/usr/bin/env node
// Generate ~/CLAUDE.md from template + config. Used by doctor.sh for auto-fix.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { hostname } from 'os';
import { fileURLToPath } from 'url';

const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME;
const configPath = join(HOME, '.relaygent', 'config.json');
const templatePath = join(REPO_DIR, 'templates', 'CLAUDE.md');
const outPath = join(HOME, 'CLAUDE.md');

if (existsSync(outPath) && !process.argv.includes('--force')) {
	console.log('~/CLAUDE.md already exists (use --force to overwrite)'); process.exit(0);
}
if (!existsSync(configPath)) { console.error('No config.json — run relaygent setup first'); process.exit(1); }
if (!existsSync(templatePath)) { console.error('Template not found:', templatePath); process.exit(1); }

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const user = HOME.split('/').pop();
const [kb, data, repo] = [config.paths?.kb, config.paths?.data, REPO_DIR].map(p => (p || '').replace(HOME, '~'));
const vars = {
	HOST: hostname(), PLATFORM: process.platform, USER: user, HOME,
	REPO: repo, KB: kb, DATA: data,
	HUB_PORT: config.hub?.port || 8080,
	NOTIF_PORT: config.services?.notifications?.port || 8083,
	HS_PORT: config.services?.hammerspoon?.port || 8097,
};
let content = readFileSync(templatePath, 'utf-8');
for (const [k, v] of Object.entries(vars)) content = content.replaceAll(`{{${k}}}`, v);
writeFileSync(outPath, content);
console.log('Generated', outPath);

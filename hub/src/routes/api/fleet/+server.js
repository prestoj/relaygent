import { json } from '@sveltejs/kit';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';

const CONFIG_FILE = `${os.homedir()}/.relaygent/config.json`;
const HUB_PORT = process.env.PORT || 8080;
const TIMEOUT_MS = 4000;

function readConfig() {
	try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
	catch { return {}; }
}

function buildFleetList(cfg) {
	const tls = cfg.hub?.tls?.cert;
	const scheme = tls ? 'https' : 'http';
	const local = { name: os.hostname(), url: `${scheme}://127.0.0.1:${HUB_PORT}`, local: true };
	const peers = (cfg.fleet || []).filter(p => p.url && p.name).map(p => ({ ...p, local: false }));
	return [local, ...peers];
}

/** Fetch JSON from a URL, accepting self-signed TLS certs */
function fetchJson(url) {
	return new Promise((resolve) => {
		const mod = url.startsWith('https') ? https : http;
		const req = mod.get(url, { rejectUnauthorized: false, timeout: TIMEOUT_MS }, (res) => {
			let data = '';
			res.on('data', c => data += c);
			res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
		});
		req.on('error', () => resolve(null));
		req.on('timeout', () => { req.destroy(); resolve(null); });
	});
}

async function queryPeer(peer) {
	const [health, session] = await Promise.all([
		fetchJson(`${peer.url}/api/health`),
		fetchJson(`${peer.url}/api/session/live`),
	]);
	return { ...peer, health, session };
}

function writeConfig(cfg) {
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

/** GET /api/fleet — query all fleet peers for health + live session */
export async function GET() {
	const cfg = readConfig();
	const fleet = buildFleetList(cfg);
	const results = await Promise.all(fleet.map(queryPeer));
	return json(results);
}

/** POST /api/fleet — add a fleet peer { name, url } */
export async function POST({ request }) {
	const { name, url } = await request.json();
	if (!name || !url) return json({ error: 'name and url required' }, { status: 400 });
	const cfg = readConfig();
	if (!cfg.fleet) cfg.fleet = [];
	if (cfg.fleet.some(p => p.name === name)) return json({ error: 'peer already exists' }, { status: 409 });
	cfg.fleet.push({ name, url: url.replace(/\/+$/, '') });
	writeConfig(cfg);
	return json({ ok: true, fleet: cfg.fleet });
}

/** DELETE /api/fleet — remove a fleet peer { name } */
export async function DELETE({ request }) {
	const { name } = await request.json();
	if (!name) return json({ error: 'name required' }, { status: 400 });
	const cfg = readConfig();
	if (!cfg.fleet) return json({ error: 'no peers configured' }, { status: 404 });
	const before = cfg.fleet.length;
	cfg.fleet = cfg.fleet.filter(p => p.name !== name);
	if (cfg.fleet.length === before) return json({ error: 'peer not found' }, { status: 404 });
	writeConfig(cfg);
	return json({ ok: true, fleet: cfg.fleet });
}

#!/usr/bin/env node
/**
 * Gmail OAuth setup — interactive first-time authentication.
 * Run once to connect Gmail to the email MCP and poller.
 *
 * Usage: node email/setup-gmail.mjs [--keys /path/to/gcp-oauth.keys.json]
 *
 * Prerequisites: A Google Cloud project with Gmail API enabled and
 * Desktop app OAuth credentials downloaded (gcp-oauth.keys.json).
 */
import { createInterface } from 'readline';
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { createServer } from 'http';
import { parse as parseUrl } from 'url';
import { google } from 'googleapis';

const HOME = homedir();
const GMAIL_DIR = join(HOME, '.relaygent', 'gmail');
const KEYS_PATH = join(GMAIL_DIR, 'gcp-oauth.keys.json');
const TOKEN_PATH = join(GMAIL_DIR, 'credentials.json');
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));
const open = (url) => spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });

function loadKeys() {
  const raw = JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
  return raw.installed || raw.web;
}

function buildAuthUrl(keys) {
  const oauth2 = new google.auth.OAuth2(keys.client_id, keys.client_secret, REDIRECT_URI);
  return oauth2.generateAuthUrl({
    access_type: 'offline', prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.modify'],
  });
}

async function exchangeCode(keys, code) {
  const oauth2 = new google.auth.OAuth2(keys.client_id, keys.client_secret, REDIRECT_URI);
  const { tokens } = await oauth2.getToken(code);
  const tmp = TOKEN_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(tokens, null, 2));
  renameSync(tmp, TOKEN_PATH);
  return tokens;
}

async function verifyTokens(keys, tokens) {
  const oauth2 = new google.auth.OAuth2(keys.client_id, keys.client_secret, REDIRECT_URI);
  oauth2.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const { data } = await gmail.users.getProfile({ userId: 'me' });
  return data.emailAddress;
}

/** Wait for OAuth redirect on localhost:8888. Returns code or null on timeout. */
function waitForCode(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const { query } = parseUrl(req.url, true);
      if (query.code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Gmail authorized!</h2><p>You can close this tab.</p></body></html>');
        server.close();
        resolve(query.code);
      } else {
        const err = query.error || 'unknown';
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h2>OAuth error: ${err}</h2></body></html>`);
        server.close();
        resolve(null);
      }
    });
    server.listen(REDIRECT_PORT, '127.0.0.1');
    setTimeout(() => { server.close(); resolve(null); }, timeoutMs);
  });
}

async function main() {
  console.log(`${C.bold}Gmail OAuth Setup${C.reset}`);
  console.log('Connects Gmail to the email MCP and poller.\n');
  mkdirSync(GMAIL_DIR, { recursive: true });

  // Accept --keys flag to copy credentials file
  const keysIdx = process.argv.indexOf('--keys');
  if (keysIdx !== -1) {
    const src = resolve(process.argv[keysIdx + 1] || '');
    if (!existsSync(src)) { console.log(`${C.red}File not found: ${src}${C.reset}`); process.exit(1); }
    copyFileSync(src, KEYS_PATH);
    console.log(`${C.green}Copied keys to ${KEYS_PATH}${C.reset}\n`);
  }

  // Guide user to create GCP credentials if needed
  if (!existsSync(KEYS_PATH)) {
    console.log(`${C.yellow}Step 1: Create OAuth credentials in Google Cloud Console${C.reset}\n`);
    console.log(`  1. ${C.bold}https://console.cloud.google.com/${C.reset}`);
    console.log(`  2. Create or select a project`);
    console.log(`  3. APIs & Services → Library → ${C.bold}Gmail API${C.reset} → Enable`);
    console.log(`  4. APIs & Services → Credentials → ${C.bold}Create Credentials → OAuth client ID${C.reset}`);
    console.log(`     Application type: ${C.bold}Desktop app${C.reset} → Create → Download JSON`);
    console.log(`  5. OAuth consent screen → Test users → add your Gmail address\n`);
    console.log(`  ${C.dim}Opening Google Cloud Console...${C.reset}`);
    open('https://console.cloud.google.com/');
    const p = (await ask(`${C.cyan}Path to downloaded JSON file:${C.reset} `)).trim().replace(/^~/, HOME);
    const src = resolve(p);
    if (!existsSync(src)) { console.log(`${C.red}Not found: ${src}${C.reset}`); process.exit(1); }
    copyFileSync(src, KEYS_PATH);
    console.log(`${C.green}Keys saved to ${KEYS_PATH}${C.reset}\n`);
  } else {
    console.log(`${C.green}Keys found.${C.reset}\n`);
  }

  const keys = loadKeys();
  const authUrl = buildAuthUrl(keys);

  console.log(`${C.yellow}Step 2: Authorize in browser${C.reset}`);
  console.log(`${C.dim}Opening Google sign-in...${C.reset}\n`);
  open(authUrl);

  console.log(`Waiting for authorization (2 min timeout)...`);
  const code = await waitForCode();

  if (!code) {
    console.log(`${C.red}Timed out or auth error.${C.reset}`);
    console.log(`Try again or manually visit:\n${authUrl}`);
    process.exit(1);
  }

  process.stdout.write('Exchanging code for tokens...');
  let tokens;
  try {
    tokens = await exchangeCode(keys, code);
    console.log(` ${C.green}done${C.reset}`);
  } catch (e) {
    console.log(`\n${C.red}Failed: ${e.message}${C.reset}`);
    process.exit(1);
  }

  process.stdout.write('Verifying...');
  try {
    const email = await verifyTokens(keys, tokens);
    console.log(` ${C.green}${email}${C.reset}`);
    console.log(`\n${C.green}Gmail configured!${C.reset} Credentials: ${TOKEN_PATH}`);
    console.log(`Run ${C.bold}relaygent restart${C.reset} to activate the email MCP and poller.`);
  } catch (e) {
    console.log(`\n${C.yellow}Warning: could not verify (${e.message}).${C.reset}`);
    console.log(`Credentials saved — try restarting the relay.`);
  }
  rl.close();
}

main().catch(e => { console.error(`${C.red}Error: ${e.message}${C.reset}`); process.exit(1); });

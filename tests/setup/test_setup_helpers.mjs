/**
 * Tests for setup-helpers.mjs — onboarding helper functions.
 * Run: node --test test_setup_helpers.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `relaygent-setup-test-${process.pid}`);
const FAKE_HOME = join(TEST_DIR, 'home');
const FAKE_REPO = join(TEST_DIR, 'repo');

before(() => {
	mkdirSync(FAKE_HOME, { recursive: true });
	mkdirSync(join(FAKE_REPO, 'templates'), { recursive: true });
	mkdirSync(join(FAKE_REPO, 'hooks'), { recursive: true });
	mkdirSync(join(FAKE_REPO, 'harness'), { recursive: true });
	// Create minimal CLAUDE.md template
	writeFileSync(join(FAKE_REPO, 'templates', 'CLAUDE.md'),
		'# {{HOST}}\nUser: {{USER}}\nHome: {{HOME}}\nRepo: {{REPO}}\nKB: {{KB}}\n' +
		'Data: {{DATA}}\nPlatform: {{PLATFORM}}\nHub: {{HUB_PORT}}\nNotif: {{NOTIF_PORT}}\n');
});

after(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const { envFromConfig, setupClaudeMd, setupHooks } =
	await import('../../setup/setup-helpers.mjs');

const C = { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', red: '' };

describe('envFromConfig', () => {
	it('returns correct env vars from config', () => {
		const config = {
			hub: { port: 8080 },
			paths: { data: '/tmp/data', kb: '/tmp/kb' },
		};
		const env = envFromConfig(config);
		assert.equal(env.RELAYGENT_HUB_PORT, '8080');
		assert.equal(env.RELAYGENT_DATA_DIR, '/tmp/data');
		assert.equal(env.RELAYGENT_KB_DIR, '/tmp/kb');
	});

	it('coerces port to string', () => {
		const env = envFromConfig({ hub: { port: 9090 }, paths: { data: 'd', kb: 'k' } });
		assert.equal(typeof env.RELAYGENT_HUB_PORT, 'string');
	});
});

describe('setupClaudeMd', () => {
	it('creates CLAUDE.md from template with substitutions', () => {
		const config = {
			paths: { kb: join(FAKE_HOME, 'kb'), data: join(FAKE_HOME, 'data') },
			hub: { port: 8080 },
			services: { notifications: { port: 8083 } },
		};
		const claudeMd = join(FAKE_HOME, 'CLAUDE.md');
		setupClaudeMd(FAKE_HOME, config, FAKE_REPO, C);
		assert.ok(existsSync(claudeMd));
		const content = readFileSync(claudeMd, 'utf-8');
		assert.ok(content.includes('8080'), 'should contain hub port');
		assert.ok(content.includes('8083'), 'should contain notif port');
		assert.ok(!content.includes('{{'), 'no unreplaced template vars');
	});

	it('does not overwrite existing CLAUDE.md', () => {
		const claudeMd = join(FAKE_HOME, 'CLAUDE.md');
		writeFileSync(claudeMd, 'custom content');
		const config = {
			paths: { kb: '/kb', data: '/data' },
			hub: { port: 8080 },
			services: { notifications: { port: 8083 } },
		};
		setupClaudeMd(FAKE_HOME, config, FAKE_REPO, C);
		assert.equal(readFileSync(claudeMd, 'utf-8'), 'custom content');
	});
});

describe('setupHooks', () => {
	it('creates project settings with hooks', () => {
		const config = {
			hub: { port: 8080 },
			services: { notifications: { port: 8083 }, hammerspoon: { port: 8097 } },
		};
		setupHooks(config, FAKE_REPO, FAKE_HOME, C);

		// Check harness/settings.json was created
		const harnessSettings = join(FAKE_REPO, 'harness', 'settings.json');
		assert.ok(existsSync(harnessSettings));
		const settings = JSON.parse(readFileSync(harnessSettings, 'utf-8'));
		assert.ok(settings.hooks, 'should have hooks');
		assert.ok(settings.hooks.PostToolUse, 'should have PostToolUse hooks');
		assert.ok(settings.hooks.SessionStart, 'should have SessionStart hooks');
	});

	it('registers MCP servers in .claude.json', () => {
		const config = {
			hub: { port: 8080 },
			services: { notifications: { port: 8083 }, hammerspoon: { port: 8097 } },
		};
		setupHooks(config, FAKE_REPO, FAKE_HOME, C);
		const claudeJson = join(FAKE_HOME, '.claude.json');
		assert.ok(existsSync(claudeJson));
		const parsed = JSON.parse(readFileSync(claudeJson, 'utf-8'));
		assert.ok(parsed.mcpServers['hub-chat'], 'hub-chat MCP registered');
		assert.ok(parsed.mcpServers['relaygent-notifications'], 'notifications MCP registered');
		assert.ok(parsed.mcpServers['computer-use'], 'computer-use MCP registered');
		assert.ok(parsed.mcpServers['secrets'], 'secrets MCP registered');
		assert.ok(parsed.mcpServers['email'], 'email MCP registered');
		assert.ok(parsed.mcpServers['slack'], 'slack MCP registered');
	});

	it('preserves existing .claude.json fields', () => {
		const claudeJson = join(FAKE_HOME, '.claude.json');
		writeFileSync(claudeJson, JSON.stringify({ customField: 'keep' }));
		const config = {
			hub: { port: 8080 },
			services: { notifications: { port: 8083 }, hammerspoon: { port: 8097 } },
		};
		setupHooks(config, FAKE_REPO, FAKE_HOME, C);
		const parsed = JSON.parse(readFileSync(claudeJson, 'utf-8'));
		assert.equal(parsed.customField, 'keep');
		assert.ok(parsed.mcpServers['hub-chat']);
	});

	it('passes correct ports to MCP server envs', () => {
		const config = {
			hub: { port: 9090 },
			services: { notifications: { port: 9093 }, hammerspoon: { port: 9097 } },
		};
		// Reset .claude.json
		const claudeJson = join(FAKE_HOME, '.claude.json');
		writeFileSync(claudeJson, '{}');
		setupHooks(config, FAKE_REPO, FAKE_HOME, C);
		const parsed = JSON.parse(readFileSync(claudeJson, 'utf-8'));
		assert.equal(parsed.mcpServers['hub-chat'].env.HUB_PORT, '9090');
		assert.equal(parsed.mcpServers['relaygent-notifications'].env.RELAYGENT_NOTIFICATIONS_PORT, '9093');
		assert.equal(parsed.mcpServers['computer-use'].env.HAMMERSPOON_PORT, '9097');
	});
});

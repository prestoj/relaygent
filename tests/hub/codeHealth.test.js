/**
 * Tests for hub/src/lib/codeHealth.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let getCodeHealth;

before(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-test-'));
	({ getCodeHealth } = await import('../../hub/src/lib/codeHealth.js'));
});

after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeFile(relPath, lines) {
	const full = path.join(tmpDir, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, Array(lines).fill('// line').join('\n') + '\n');
}

test('getCodeHealth: returns empty for missing dirs', () => {
	const result = getCodeHealth(tmpDir);
	assert.deepEqual(result.files, []);
	assert.equal(result.threshold, 150);
	assert.equal(result.limit, 200);
});

test('getCodeHealth: finds files over threshold', () => {
	writeFile('hub/src/big.js', 160);
	writeFile('hub/src/small.js', 50);
	const result = getCodeHealth(tmpDir);
	assert.equal(result.files.length, 1);
	assert.equal(result.files[0].path, 'hub/src/big.js');
	assert.equal(result.files[0].lines, 160);
	assert.equal(result.files[0].pct, 80);
});

test('getCodeHealth: ignores files below threshold', () => {
	writeFile('hub/src/ok.js', 149);
	const result = getCodeHealth(tmpDir);
	const ok = result.files.find(f => f.path === 'hub/src/ok.js');
	assert.equal(ok, undefined);
});

test('getCodeHealth: sorts by line count descending', () => {
	writeFile('hub/src/a.js', 190);
	writeFile('hub/src/b.js', 175);
	const result = getCodeHealth(tmpDir);
	const aIdx = result.files.findIndex(f => f.path === 'hub/src/a.js');
	const bIdx = result.files.findIndex(f => f.path === 'hub/src/b.js');
	assert.ok(aIdx < bIdx, 'a.js (190) should come before b.js (175)');
});

test('getCodeHealth: respects file extensions', () => {
	writeFile('hub/src/data.json', 200);
	writeFile('hub/src/readme.md', 200);
	const result = getCodeHealth(tmpDir);
	const json = result.files.find(f => f.path.includes('data.json'));
	const md = result.files.find(f => f.path.includes('readme.md'));
	assert.equal(json, undefined, 'should skip .json files');
	assert.equal(md, undefined, 'should skip .md files');
});

test('getCodeHealth: skips node_modules', () => {
	writeFile('hub/src/node_modules/dep.js', 200);
	const result = getCodeHealth(tmpDir);
	const dep = result.files.find(f => f.path.includes('node_modules'));
	assert.equal(dep, undefined);
});

test('getCodeHealth: handles multiple source dirs', () => {
	writeFile('harness/tool.py', 170);
	writeFile('notifications/server.py', 180);
	const result = getCodeHealth(tmpDir);
	const h = result.files.find(f => f.path === 'harness/tool.py');
	const n = result.files.find(f => f.path === 'notifications/server.py');
	assert.ok(h, 'should find harness files');
	assert.ok(n, 'should find notifications files');
});

test('getCodeHealth: pct calculation correct', () => {
	writeFile('hub/src/exact.js', 200);
	const result = getCodeHealth(tmpDir);
	const f = result.files.find(f => f.path === 'hub/src/exact.js');
	assert.equal(f.pct, 100);
});

test('getCodeHealth: handles .svelte files', () => {
	writeFile('hub/src/comp.svelte', 155);
	const result = getCodeHealth(tmpDir);
	const f = result.files.find(f => f.path === 'hub/src/comp.svelte');
	assert.ok(f, 'should find .svelte files');
	assert.equal(f.lines, 155);
});

test('getCodeHealth: handles .sh files', () => {
	writeFile('bin/tool.sh', 165);
	const result = getCodeHealth(tmpDir);
	const f = result.files.find(f => f.path === 'bin/tool.sh');
	assert.ok(f, 'should find .sh files');
});

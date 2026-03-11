/**
 * Tests for /api/files/thumbnail endpoint.
 *
 * Run: node --import=./tests/hub/helpers/kit-loader.mjs --test tests/hub/files-thumbnail.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-thumb-'));
process.env.RELAYGENT_DATA_DIR = tmpDir;

const sharedDir = path.join(tmpDir, 'shared');
fs.mkdirSync(sharedDir, { recursive: true });

// Create a tiny valid MP4 using ffmpeg (1 frame, solid color)
const testVideo = path.join(sharedDir, 'test.mp4');
try {
	execSync(
		`ffmpeg -y -f lavfi -i color=c=blue:s=64x64:d=3 -c:v libx264 -t 3 ${JSON.stringify(testVideo)}`,
		{ stdio: 'ignore', timeout: 15000 },
	);
} catch {
	console.log('ffmpeg not available, skipping thumbnail tests');
	process.exit(0);
}

// Also create a non-video file
fs.writeFileSync(path.join(sharedDir, 'readme.txt'), 'hello');

const { GET } = await import('../../hub/src/routes/api/files/thumbnail/+server.js');

function req(params = {}) {
	const u = new URL('http://localhost/api/files/thumbnail');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return { url: u };
}

test('thumbnail: returns 400 for missing name', async () => {
	assert.equal(GET(req()).status, 400);
});

test('thumbnail: returns 400 for non-video file', async () => {
	assert.equal(GET(req({ name: 'readme.txt' })).status, 400);
});

test('thumbnail: returns 404 for non-existent video', async () => {
	assert.equal(GET(req({ name: 'nope.mp4' })).status, 404);
});

test('thumbnail: generates JPEG thumbnail from video', async () => {
	const res = GET(req({ name: 'test.mp4' }));
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'image/jpeg');
	assert.equal(res.headers.get('cache-control'), 'max-age=3600');
	const buf = Buffer.from(await res.arrayBuffer());
	assert.ok(buf.length > 100, 'thumbnail should have content');
	// JPEG magic bytes
	assert.equal(buf[0], 0xFF);
	assert.equal(buf[1], 0xD8);
});

test('thumbnail: serves cached thumbnail on second request', async () => {
	const thumbDir = path.join(sharedDir, '.thumbnails');
	assert.ok(fs.existsSync(path.join(thumbDir, 'test.mp4.jpg')), 'cache file should exist');
	const res = GET(req({ name: 'test.mp4' }));
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'image/jpeg');
});

test('thumbnail: .thumbnails dir is hidden from file listing', async () => {
	const { listFiles } = await import('../../hub/src/lib/files.js');
	const files = listFiles();
	const names = files.map(f => f.name);
	assert.ok(!names.includes('.thumbnails'), '.thumbnails should be hidden');
});

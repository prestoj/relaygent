import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getFilePath, getSharedDir } from '$lib/files.js';

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);
const EXEC_ENV = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };

function getThumbDir() {
	const dir = path.join(getSharedDir(), '.thumbnails');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** GET /api/files/thumbnail?name=video.mp4 — generate and cache video thumbnail */
export function GET({ url }) {
	const name = url.searchParams.get('name');
	const result = getFilePath(name);
	if (result.error) return new Response(result.error, { status: 400 });

	const ext = path.extname(name).toLowerCase();
	if (!VIDEO_EXT.has(ext)) return new Response('Not a video file', { status: 400 });
	if (!fs.existsSync(result.path)) return new Response('File not found', { status: 404 });

	const thumbDir = getThumbDir();
	const thumbName = name + '.jpg';
	const thumbPath = path.join(thumbDir, thumbName);

	// Return cached thumbnail if newer than the video
	if (fs.existsSync(thumbPath)) {
		const tStat = fs.statSync(thumbPath);
		const vStat = fs.statSync(result.path);
		if (tStat.mtimeMs > vStat.mtimeMs) {
			return new Response(fs.readFileSync(thumbPath), {
				headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' },
			});
		}
	}

	// Generate thumbnail: frame at 2s, scaled to 320px wide
	try {
		execSync(
			`ffmpeg -y -ss 2 -i ${JSON.stringify(result.path)} -vframes 1 -vf "scale=320:-1" ${JSON.stringify(thumbPath)}`,
			{ timeout: 15000, stdio: 'ignore', env: EXEC_ENV },
		);
	} catch {
		return new Response('Thumbnail generation failed', { status: 500 });
	}

	if (!fs.existsSync(thumbPath)) return new Response('Thumbnail generation failed', { status: 500 });

	return new Response(fs.readFileSync(thumbPath), {
		headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' },
	});
}

import { json } from '@sveltejs/kit';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

const SCREENSHOT_PATH = '/tmp/claude-screenshot.png';
const SCALED_PATH = '/tmp/claude-screenshot-scaled.png';
const HS_PORT = process.env.HAMMERSPOON_PORT || '8097';
const HAMMERSPOON_URL = `http://127.0.0.1:${HS_PORT}/screenshot`;
const MAX_WIDTH = 1280;
const IS_MAC = os.platform() === 'darwin';

function scaleImage(srcPath, dstPath, maxWidth) {
	if (IS_MAC) {
		execSync(`sips -Z ${maxWidth} --out "${dstPath}" "${srcPath}"`, { timeout: 5000 });
	} else {
		execSync(`convert "${srcPath}" -resize ${maxWidth}x "${dstPath}"`, { timeout: 5000 });
	}
}

export async function GET() {
	try {
		await fetch(HAMMERSPOON_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: SCREENSHOT_PATH }),
			signal: AbortSignal.timeout(8000),
		});
		let imgPath = SCREENSHOT_PATH;
		const hdr = Buffer.alloc(24);
		const fd = fs.openSync(SCREENSHOT_PATH, 'r');
		fs.readSync(fd, hdr, 0, 24, 0);
		fs.closeSync(fd);
		const pngWidth = hdr.readUInt32BE(16);
		if (pngWidth > MAX_WIDTH) {
			scaleImage(SCREENSHOT_PATH, SCALED_PATH, MAX_WIDTH);
			imgPath = SCALED_PATH;
		}
		const data = fs.readFileSync(imgPath);
		return new Response(data, {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'no-cache, no-store',
			}
		});
	} catch {
		return json({ error: 'screenshot failed' }, { status: 502 });
	}
}

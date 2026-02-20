/**
 * Hub WebSocket wrapper — adds /ws/chat live chat to the SvelteKit server.
 *
 * Intercepts HTTP upgrade events before SvelteKit handles them.
 * Watches the trigger file written by POST /api/chat to broadcast new messages.
 *
 * Usage: node hub/ws-server.mjs  (instead of node hub/build/index.js)
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRIGGER_FILE = process.env.HUB_CHAT_TRIGGER_FILE || '/tmp/hub-chat-new.json';

// Import SvelteKit handler directly — avoids build/index.js starting its own HTTP server
const { handler } = await import('./build/handler.js');

// Create HTTP server backed by SvelteKit
const server = createServer(handler);

// WebSocket server — no built-in HTTP server, we handle upgrades manually
const wss = new WebSocketServer({ noServer: true });

// Connected chat clients
const clients = new Set();

wss.on('connection', (ws) => {
	clients.add(ws);
	ws.on('close', () => clients.delete(ws));
	ws.on('error', () => clients.delete(ws));
});

// Intercept HTTP upgrade requests for /ws/chat
server.on('upgrade', (req, socket, head) => {
	if (req.url === '/ws/chat') {
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	} else {
		socket.destroy();
	}
});

// Watch trigger file and broadcast new messages to all clients
let lastTrigger = '';
function watchTrigger() {
	try {
		fs.watch(path.dirname(TRIGGER_FILE), (event, filename) => {
			if (filename !== path.basename(TRIGGER_FILE)) return;
			try {
				const raw = fs.readFileSync(TRIGGER_FILE, 'utf-8');
				if (raw === lastTrigger) return;
				lastTrigger = raw;
				const msg = JSON.parse(raw);
				const payload = JSON.stringify({ type: 'message', data: msg });
				for (const client of clients) {
					if (client.readyState === 1) client.send(payload);
				}
			} catch { /* file may not exist yet or be mid-write */ }
		});
	} catch {
		// /tmp may not be watchable in some envs — fall back to polling
		setInterval(() => {
			try {
				const raw = fs.readFileSync(TRIGGER_FILE, 'utf-8');
				if (raw === lastTrigger) return;
				lastTrigger = raw;
				const msg = JSON.parse(raw);
				const payload = JSON.stringify({ type: 'message', data: msg });
				for (const client of clients) {
					if (client.readyState === 1) client.send(payload);
				}
			} catch { /* ignore */ }
		}, 500);
	}
}
watchTrigger();

const PORT = parseInt(process.env.PORT || '8080', 10);
server.listen(PORT, '0.0.0.0', () => {
	console.log(`Hub listening on :${PORT} (WebSocket /ws/chat enabled)`);
});

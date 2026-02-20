/**
 * Hub WebSocket wrapper — unified /ws endpoint for relay activity + chat.
 *
 * Both the dashboard (/ws/relay was) and ChatBubble (/ws/chat was) connect here.
 * Messages are typed: activity/result/context/hook/session for dashboard;
 * message for chat. Each client ignores types it doesn't care about.
 *
 * Usage: node hub/ws-server.mjs  (instead of node hub/build/index.js)
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeInput, summarizeResult, extractResultText, findLatestSession } from './src/lib/relayActivity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRIGGER_FILE = process.env.HUB_CHAT_TRIGGER_FILE || '/tmp/hub-chat-new.json';
const HOOK_OUTPUT = '/tmp/relaygent-hook-output.json';

const { handler } = await import('./build/handler.js');
const server = createServer(handler);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
	if (req.url === '/ws') {
		wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
	} else {
		socket.destroy();
	}
});

function broadcast(msg) {
	const data = JSON.stringify(msg);
	wss.clients.forEach(c => { try { if (c.readyState === 1) c.send(data); } catch {} });
}

// --- Relay: parse session JSONL and stream activity ---
const pendingTools = new Map();
const MAX_PENDING = 200;

function parseSessionLine(line) {
	try {
		const entry = JSON.parse(line);
		if (entry.type === 'assistant' && entry.message?.content) {
			const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
			const activities = [];
			for (const item of items) {
				if (item?.type === 'tool_use') {
					const act = {
						type: 'tool', name: item.name, time: entry.timestamp,
						input: summarizeInput(item.name, item.input), params: item.input || {},
						result: '', toolUseId: item.id,
					};
					pendingTools.set(item.id, act);
					if (pendingTools.size > MAX_PENDING) pendingTools.delete(pendingTools.keys().next().value);
					activities.push(act);
				} else if (item?.type === 'text' && item.text?.length > 10) {
					activities.push({ type: 'text', time: entry.timestamp, text: item.text });
				}
			}
			return activities;
		}
		if (entry.type === 'user' && entry.message?.content) {
			const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
			for (const item of items) {
				if (item?.type === 'tool_result' && pendingTools.has(item.tool_use_id)) {
					const result = summarizeResult(item.content);
					const fullResult = extractResultText(item.content);
					if (result || fullResult) broadcast({ type: 'result', toolUseId: item.tool_use_id, result, fullResult });
					pendingTools.delete(item.tool_use_id);
				}
			}
		}
	} catch (e) { if (!(e instanceof SyntaxError)) console.error('parseSessionLine:', e.message); }
	return [];
}

let watchedFile = null, fileWatcher = null, lastSize = 0, incompleteLine = '';

function startWatching() {
	const sessionFile = findLatestSession();
	if (!sessionFile || (watchedFile === sessionFile && fileWatcher)) return;
	if (fileWatcher) fileWatcher.close();
	watchedFile = sessionFile; lastSize = fs.statSync(sessionFile).size; pendingTools.clear(); incompleteLine = '';
	fileWatcher = fs.watch(sessionFile, () => {
		try {
			const stat = fs.statSync(sessionFile);
			if (stat.size < lastSize) { lastSize = stat.size; incompleteLine = ''; }
			if (stat.size <= lastSize) return;
			const chunkSize = Math.min(stat.size - lastSize, 1024 * 1024);
			const buf = Buffer.alloc(chunkSize);
			const fd = fs.openSync(sessionFile, 'r');
			try { fs.readSync(fd, buf, 0, chunkSize, lastSize); } finally { fs.closeSync(fd); }
			lastSize += chunkSize;
			const chunk = incompleteLine + buf.toString('utf-8');
			const lines = chunk.split('\n');
			incompleteLine = chunk.endsWith('\n') ? '' : lines.pop();
			for (const line of lines.filter(l => l.trim()))
				for (const act of parseSessionLine(line)) broadcast({ type: 'activity', data: act });
			try {
				const pct = parseInt(fs.readFileSync('/tmp/relaygent-context-pct', 'utf-8').trim(), 10);
				if (!isNaN(pct)) broadcast({ type: 'context', pct });
			} catch { /* no context file */ }
		} catch (e) { console.error('Session watcher error:', e.message); }
	});
	console.log(`Watching: ${sessionFile}`);
}

wss.on('connection', ws => {
	startWatching();
	ws.send(JSON.stringify({ type: 'session', status: findLatestSession() ? 'found' : 'waiting' }));
	try { ws.send(JSON.stringify({ type: 'hook', data: JSON.parse(fs.readFileSync(HOOK_OUTPUT, 'utf-8')) })); } catch { /* no hook output */ }
});

let lastHookTs = 0;
setInterval(() => {
	try {
		const data = JSON.parse(fs.readFileSync(HOOK_OUTPUT, 'utf-8'));
		if (data.ts && data.ts > lastHookTs) { lastHookTs = data.ts; broadcast({ type: 'hook', data }); }
	} catch { /* missing or invalid */ }
}, 1000);

setInterval(() => {
	const current = findLatestSession();
	if (current && current !== watchedFile) { startWatching(); broadcast({ type: 'session', status: 'found', file: current }); }
}, 3000);

// --- Chat: watch trigger file and broadcast new messages ---
let lastTrigger = '';
function watchTrigger() {
	try {
		fs.watch(path.dirname(TRIGGER_FILE), (event, filename) => {
			if (filename !== path.basename(TRIGGER_FILE)) return;
			try {
				const raw = fs.readFileSync(TRIGGER_FILE, 'utf-8');
				if (raw === lastTrigger) return;
				lastTrigger = raw;
				broadcast({ type: 'message', data: JSON.parse(raw) });
			} catch { /* mid-write or missing */ }
		});
	} catch {
		setInterval(() => {
			try {
				const raw = fs.readFileSync(TRIGGER_FILE, 'utf-8');
				if (raw === lastTrigger) return;
				lastTrigger = raw;
				broadcast({ type: 'message', data: JSON.parse(raw) });
			} catch { /* ignore */ }
		}, 500);
	}
}
watchTrigger();

const PORT = parseInt(process.env.PORT || '8080', 10);
server.listen(PORT, '0.0.0.0', () => {
	console.log(`Hub listening on :${PORT} (WebSocket /ws enabled)`);
});

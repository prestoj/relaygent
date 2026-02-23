/**
 * WebSocket-to-TCP proxy for VNC connections.
 * Bridges noVNC (WebSocket) clients to a local VNC server (TCP port 5900).
 */
import { WebSocketServer } from 'ws';
import net from 'net';

const VNC_PORT = parseInt(process.env.VNC_PORT || '5900', 10);

export const wssVnc = new WebSocketServer({ noServer: true });

wssVnc.on('connection', (ws) => {
	const vnc = net.createConnection(VNC_PORT, '127.0.0.1');
	vnc.on('data', d => { try { if (ws.readyState === 1) ws.send(d); } catch {} });
	vnc.on('close', () => ws.close());
	vnc.on('error', () => ws.close());
	ws.on('message', d => { try { vnc.write(Buffer.from(d)); } catch {} });
	ws.on('close', () => vnc.destroy());
	ws.on('error', () => vnc.destroy());
});

// Chrome DevTools Protocol — connects to Chrome for browser automation with auto-reconnect
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { ensureChrome } from "./cdp-chrome.mjs";

const CDP_PORT = parseInt(process.env.RELAYGENT_CDP_PORT || "9223", 10);
const TAB_ID_FILE = "/tmp/relaygent-cdp-tabid";
let _ws = null, _msgId = 0, _connectPromise = null, _reconnectTimer = null;
const _pending = new Map();
let _events = []; const _persistent = {};
let _lastDialog = null, _nextDialogConfig = null;
export const getLastDialog = () => _lastDialog;
export const setNextDialogConfig = (c) => { _nextDialogConfig = c; };
let _currentTabId = (() => { try { return readFileSync(TAB_ID_FILE, "utf8").trim() || null; } catch { return null; } })();
function _saveTabId(id) { _currentTabId = id; try { writeFileSync(TAB_ID_FILE, id || ""); } catch {} }
function log(msg) { process.stderr.write(`[cdp] ${msg}\n`); }
function _scheduleReconnect(delay = 1000) {
	if (_reconnectTimer || _connectPromise) return;
	_reconnectTimer = setTimeout(async () => {
		_reconnectTimer = null;
		const conn = await getConnection().catch(() => null);
		if (!conn && delay < 16000) _scheduleReconnect(delay * 2);
	}, delay);
}
function _cancelReconnect() { if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; } }
const cdpCmd = (p) => new Promise(r => { const q = http.request({ hostname: "localhost", port: CDP_PORT, path: p, timeout: 2000 }, s => { s.on("data", () => {}); s.on("end", () => r(s.statusCode === 200)); }); q.on("error", () => r(false)); q.end(); });
const cdpActivate = (id) => cdpCmd(`/json/activate/${id}`);
export const cdpCloseTab = (id) => cdpCmd(`/json/close/${id}`);
const cdpHttp = (path) => new Promise(resolve => {
  const req = http.request({ hostname: "localhost", port: CDP_PORT, path, timeout: 3000 }, res => {
    const chunks = [];
    res.on("data", c => chunks.push(c));
    res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { resolve(null); } });
  });
  req.on("error", () => resolve(null));
  req.on("timeout", () => { req.destroy(); resolve(null); });
  req.end();
});

async function connectTab(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", e => reject(e));
    ws.addEventListener("message", ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id && _pending.has(msg.id)) { _pending.get(msg.id)(msg); _pending.delete(msg.id); }
        else if (msg.method) {
          if (_persistent[msg.method]) _persistent[msg.method](msg);
          const idx = _events.findIndex(e => e.method === msg.method);
          if (idx >= 0) { _events.splice(idx, 1)[0].cb(); }
        }
      } catch {}
    });
    ws.addEventListener("close", () => { _ws = null; _scheduleReconnect(); });
  });
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== 1) { reject(new Error("CDP not connected")); return; }
    const id = ++_msgId;
    _pending.set(id, resolve);
    _ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { _pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
  });
}
function waitForEvent(method, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { _events = _events.filter(e => e !== entry); reject(new Error(`Event timeout: ${method}`)); }, timeoutMs);
    const entry = { method, cb: () => { clearTimeout(timer); resolve(); } };
    _events.push(entry);
  });
}
export async function getConnection() {
  if (_connectPromise) return _connectPromise;
  _connectPromise = _getConnectionImpl();
  try { return await _connectPromise; } finally { _connectPromise = null; }
}
async function _getConnectionImpl() {
  _cancelReconnect();
  if (_ws && _ws.readyState === 1) {
    try {
      const r = await Promise.race([
        send("Runtime.evaluate", { expression: "1", returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("health timeout")), 2000)),
      ]);
      if (r?.result?.result?.value === 1) return { ws: _ws };
    } catch {}
    log("health check failed, reconnecting");
    try { _ws.close(); } catch {} _ws = null;
  }
  let tabs = await cdpHttp("/json/list");
  if (!tabs) { await ensureChrome(); tabs = await cdpHttp("/json/list"); }
  if (!tabs) { await new Promise(r => setTimeout(r, 2000)); tabs = await cdpHttp("/json/list"); }
  if (!tabs) return null;
  const pages = tabs.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pages.length) return null;
  const page = pages.find(t => t.id === _currentTabId)
    ?? pages.find(t => /^https?:/.test(t.url)) ?? pages[0];
  try {
    _ws = await connectTab(page.webSocketDebuggerUrl);
    _saveTabId(page.id);
    log(`connected to ${page.url.substring(0, 60)}`);
    await _denyPerms().catch(() => {});
    send("Page.enable").catch(() => {});
    _persistent['Page.javascriptDialogOpening'] = (m) => {
      const p = m.params || {}; _lastDialog = { type: p.type, message: p.message, defaultPrompt: p.defaultPrompt || "", url: p.url || "", timestamp: Date.now() };
      const c = _nextDialogConfig || { accept: true }; _nextDialogConfig = null; _lastDialog.handled = c.accept !== false ? 'accepted' : 'dismissed';
      const hp = { accept: c.accept !== false }; if (c.promptText != null) hp.promptText = c.promptText;
      log(`${hp.accept ? 'accepted' : 'dismissed'} ${p.type} dialog`); send('Page.handleJavaScriptDialog', hp).catch(() => {});
    };
    return { ws: _ws };
  } catch (e) { log(`connect failed: ${e.message}`); return null; }
}

async function _eval(expression, awaitPromise = false) {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    return result?.result?.result?.value ?? null;
  } catch (e) { log(`eval error: ${e.message}`); _ws = null; return null; }
}
export const cdpEval = (expr) => _eval(expr);
export const cdpEvalAsync = (expr) => _eval(expr, true);
export async function cdpNavigate(url) {
  const conn = await getConnection();
  if (!conn) return false;
  try {
    try { await send("Browser.grantPermissions", { permissions: [], origin: new URL(url).origin }); } catch {}
    await send("Page.enable");
    const loaded = waitForEvent("Page.loadEventFired", 15000);
    await send("Page.navigate", { url });
    await loaded;
    if (_currentTabId) await cdpActivate(_currentTabId);
    return true;
  } catch (e) { log(`navigate error: ${e.message}`); return false; }
}
export function cdpDisconnect() { _cancelReconnect(); if (_ws) { try { _ws.close(); } catch {} _ws = null; } _saveTabId(null); }
export async function cdpSwitchTab(tabId) {
  const ok = await cdpActivate(tabId); if (!ok) return false;
  if (_ws) { try { _ws.close(); } catch {} _ws = null; } _saveTabId(tabId); return true;
}
export async function cdpSyncToVisibleTab(url) {
  cdpDisconnect();
  await new Promise(r => setTimeout(r, 800));
  const tabs = await cdpHttp("/json/list");
  if (!tabs) return;
  const pages = tabs.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  const target = pages.find(t => t.url === url || t.url.startsWith(url.replace(/\/$/, "")))
    ?? pages.find(t => /^https?:/.test(t.url)) ?? pages[0];
  if (!target) return;
  _saveTabId(target.id);
  await cdpActivate(target.id);
  log(`synced to tab: ${target.url.substring(0, 60)}`);
}

let _permsDenied = false;
async function _denyPerms() {
  if (_permsDenied) return; _permsDenied = true;
  const perms = ['clipboardReadWrite', 'notifications', 'geolocation', 'camera', 'microphone'];
  await Promise.all(perms.map(n => send("Browser.setPermission", { permission: { name: n }, setting: "denied" }).catch(() => {})));
}
export function cdpConnected() { return _ws && _ws.readyState === 1; }
export const cdpAvailable = async () => { const t = await cdpHttp("/json/list"); return t !== null && Array.isArray(t); };
export async function cdpSendCommand(method, params = {}) {
  const conn = await getConnection();
  if (!conn) return null;
  try { return await send(method, params); } catch (e) { log(`cdp cmd error: ${e.message}`); return null; }
}
export { cdpHttp };

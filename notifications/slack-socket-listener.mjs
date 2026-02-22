#!/usr/bin/env node
/**
 * Slack Socket Mode listener — real-time message delivery via WebSocket.
 * Connects using an app-level token, receives message events, and writes
 * them to a cache file for the notification poller to read.
 */
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();
const APP_TOKEN_PATH = path.join(HOME, ".relaygent", "slack", "app-token");
const USER_TOKEN_PATH = path.join(HOME, ".relaygent", "slack", "token.json");
const CACHE_FILE = "/tmp/relaygent-slack-socket-cache.json";
const LAST_ACK_FILE = path.join(HOME, ".relaygent", "slack", ".last_check_ts");
const SEEDED_CHANNELS_PATH = path.join(HOME, ".relaygent", "slack", "seeded-channels");
const MAX_MESSAGES = 50;
const SKIP_SUBTYPES = new Set(["channel_join","joiner_notification_for_inviter","bot_message","message_changed","message_deleted"]);

function readCache() {
  try { const d = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); if (!Array.isArray(d.messages)) d.messages = []; return d; }
  catch { return { messages: [], updated: 0 }; }
}
function writeCache(data) {
  data.updated = Date.now();
  const tmp = CACHE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, CACHE_FILE);
}
function getLastAckTs() {
  try { return parseFloat(fs.readFileSync(LAST_ACK_FILE, "utf-8").trim()) || 0; } catch { return 0; }
}
function log(msg) {
  console.log(`[${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}] ${msg}`);
}

let selfUid = null;

// User ID → display name cache (30min TTL, avoids repeated API calls)
const userNameCache = new Map();
async function resolveUserName(web, userId) {
  if (!userId) return null;
  const cached = userNameCache.get(userId);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.name;
  try {
    const u = await web.users.info({ user: userId });
    const name = u.user?.real_name || u.user?.display_name || u.user?.name || userId;
    userNameCache.set(userId, { name, ts: Date.now() });
    return name;
  } catch { return null; }
}
async function resolveUserMentions(web, text) {
  if (!text) return text;
  const matches = [...text.matchAll(/<@(U[A-Z0-9]+)>/g)];
  if (!matches.length) return text;
  let resolved = text;
  for (const m of matches) {
    const name = await resolveUserName(web, m[1]);
    if (name) resolved = resolved.replace(m[0], `@${name}`);
  }
  return resolved;
}

async function backfill(web) {
  const cache = readCache();
  const msgs = cache.messages || [];
  const lastCachedTs = msgs.length ? Math.max(...msgs.map(m => parseFloat(m.ts || "0"))) : 0;
  const oldest = Math.max(getLastAckTs(), lastCachedTs);
  if (!oldest) return;
  const knownIds = new Set([...(cache.knownChannels || []), ...msgs.map(m => m.channel)]);
  let added = 0;
  for (const chId of knownIds) {
    try {
      const hist = await web.conversations.history({ channel: chId, oldest: String(oldest), limit: 20 });
      for (const m of (hist.messages || []).reverse()) {
        if (m.user === selfUid || parseFloat(m.ts) <= oldest) continue;
        if (msgs.find(x => x.ts === m.ts)) continue;
        if (m.subtype && SKIP_SUBTYPES.has(m.subtype)) continue;
        const userName = await resolveUserName(web, m.user) || m.user || "";
        const text = await resolveUserMentions(web, (m.text || "").slice(0, 500));
        msgs.push({ channel: chId, channel_name: chId, user: m.user || "", user_name: userName, text, ts: m.ts, received: Date.now() });
        added++;
      }
      await new Promise(r => setTimeout(r, 500));
    } catch { /* skip */ }
  }
  if (added > 0) { cache.messages = msgs.slice(-MAX_MESSAGES); writeCache(cache); log(`Backfilled ${added} missed message(s)`); }
}

async function start() {
  const web = new WebClient(JSON.parse(fs.readFileSync(USER_TOKEN_PATH, "utf-8")).access_token);
  try { const auth = await web.auth.test(); selfUid = auth.user_id; log(`Authenticated as ${auth.user} (${selfUid})`); }
  catch (e) { log(`Warning: auth.test failed: ${e.message}`); }

  const client = new SocketModeClient({ appToken: fs.readFileSync(APP_TOKEN_PATH, "utf-8").trim() });

  client.on("message", async ({ event, body, ack }) => {
    await ack();
    if (!event || event.user === selfUid) return;
    if (event.subtype && SKIP_SUBTYPES.has(event.subtype)) return;
    const msgTs = parseFloat(event.ts || "0");
    if (msgTs <= getLastAckTs()) return;
    const channelId = event.channel || body?.event?.channel;
    if (!channelId) return;

    // Resolve channel name (DMs → user display name)
    let channelName = channelId;
    try {
      const info = await web.conversations.info({ channel: channelId });
      const ch = info.channel;
      if (ch?.is_im && ch?.user) {
        const name = await resolveUserName(web, ch.user);
        channelName = `DM: ${name || ch.user}`;
      } else { channelName = ch?.name || ch?.id || channelId; }
    } catch { /* use ID as fallback */ }

    const senderName = await resolveUserName(web, event.user) || event.user || "";
    const resolvedText = await resolveUserMentions(web, (event.text || "").slice(0, 500));
    const cache = readCache();
    if (!cache.knownChannels) cache.knownChannels = [];
    if (!cache.knownChannels.includes(channelId)) cache.knownChannels.push(channelId);
    cache.messages.push({
      channel: channelId, channel_name: channelName, user: event.user || "",
      user_name: senderName, text: resolvedText, ts: event.ts, received: Date.now(),
    });
    if (cache.messages.length > MAX_MESSAGES) cache.messages = cache.messages.slice(-MAX_MESSAGES);
    writeCache(cache);
    log(`Message in #${channelName} from ${senderName}: ${resolvedText.slice(0, 80)}`);
  });

  client.on("connected", async () => {
    clearTimeout(disconnectWatchdog);
    log("Socket Mode connected");
    const c = readCache();
    try { const ids = fs.readFileSync(SEEDED_CHANNELS_PATH,"utf-8").split("\n").filter(s=>s.trim()); c.knownChannels=[...new Set([...(c.knownChannels||[]),...ids])]; } catch {}
    writeCache(c);
    try { await backfill(web); } catch (e) { log(`Backfill error: ${e.message}`); }
  });

  let disconnectWatchdog = null;
  client.on("disconnected", () => {
    log("Socket Mode disconnected — will auto-reconnect");
    disconnectWatchdog = setTimeout(() => { log("Disconnected 10min — exiting"); process.exit(1); }, 10 * 60 * 1000);
  });

  setInterval(() => writeCache(readCache()), 5 * 60 * 1000); // heartbeat
  setInterval(async () => { try { await backfill(web); } catch {} }, 30 * 1000); // periodic backfill

  await client.start();
  log("Slack Socket Mode listener started");
}
start().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });

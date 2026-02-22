// Chrome lifecycle management — launch, patch prefs, detect process
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn, execSync } from "node:child_process";

const CDP_PORT = parseInt(process.env.RELAYGENT_CDP_PORT || "9223", 10);
const CHROME_DATA = `${process.env.HOME}/data/chrome-debug-profile`;
const CHROME_PREFS = `${CHROME_DATA}/Default/Preferences`;

function log(msg) { process.stderr.write(`[cdp-chrome] ${msg}\n`); }

let _chromeStarting = false;
export async function ensureChrome() {
  if (_chromeStarting) return; _chromeStarting = true;
  try { execSync("pkill -f google-chrome", { timeout: 2000 }); await new Promise(r => setTimeout(r, 500)); } catch {}
  const bin = existsSync("/Applications/Google Chrome.app")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome";
  try { spawn(bin, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_DATA}`, "--no-first-run"],
    { detached: true, stdio: "ignore" }).unref();
    log("auto-launched Chrome with CDP"); await new Promise(r => setTimeout(r, 4000));
  } catch (e) { log(`Chrome launch failed: ${e.message}`); } finally { _chromeStarting = false; }
}

export function patchChromePrefs() {
  try {
    const prefs = JSON.parse(readFileSync(CHROME_PREFS, "utf8"));
    prefs.profile = { ...prefs.profile, exit_type: "Normal", exited_cleanly: true,
      default_content_setting_values: { ...(prefs.profile.default_content_setting_values || {}),
        clipboard: 2, notifications: 2, geolocation: 2, media_stream_camera: 2, media_stream_mic: 2 } };
    writeFileSync(CHROME_PREFS, JSON.stringify(prefs));
    log("patched Chrome prefs: exit_type=Normal, permissions=blocked");
  } catch (e) { log(`patchChromePrefs failed: ${e.message}`); }
}

export function cdpChromePid() {
  try { return parseInt(execSync(`lsof -ti :${CDP_PORT} -s TCP:LISTEN`, { timeout: 2000 }).toString().trim()); }
  catch { return null; }
}

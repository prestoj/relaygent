"""App launcher for Linux with Chrome, alias, and Xvfb support."""
from __future__ import annotations

import os
import subprocess

_ENV = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":99")}


def _run(args, timeout=5):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=_ENV)
    return r.stdout.strip()


_ALIASES = {
    "google-chrome": ["google-chrome-stable", "chromium-browser", "chromium", "firefox"],
    "firefox": ["firefox-esr"],
    "terminal": ["xfce4-terminal", "gnome-terminal", "mate-terminal", "konsole", "xterm"],
    "text-editor": ["gedit", "mousepad", "xed", "pluma", "kate"],
    "file-manager": ["nautilus", "thunar", "nemo", "caja", "dolphin"],
}
# gnome-terminal's client-server model doesn't create visible windows on Xvfb
_XVFB_PREFER = {"gnome-terminal": ["xfce4-terminal", "mate-terminal", "konsole", "xterm"]}
_CHROME_NAMES = {"google-chrome", "google-chrome-stable", "chromium-browser", "chromium"}
_CHROME_DATA = os.path.expanduser("~/data/chrome-debug-profile")
_CHROME_ARGS = [
    "--no-sandbox", "--no-first-run", "--start-maximized", "--disable-default-apps",
    "--disable-sync", "--disable-background-networking", "--disable-component-update",
    "--disable-session-crashed-bubble", "--disable-infobars", "--test-type",
    "--remote-debugging-port=9223", "--remote-allow-origins=*",
    f"--user-data-dir={_CHROME_DATA}",
]


def _clear_stale_locks() -> None:
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.remove(os.path.join(_CHROME_DATA, name))
        except FileNotFoundError:
            pass


def _patch_chrome_prefs() -> None:
    _clear_stale_locks()
    import json as _json
    pref = f"{_CHROME_DATA}/Default/Preferences"
    try:
        data = _json.load(open(pref))
        data.setdefault("profile", {}).update(exit_type="Normal", exited_cleanly=True)
        _json.dump(data, open(pref, "w"))
    except (FileNotFoundError, ValueError, OSError):
        pass


_xvfb: bool | None = None


def _on_xvfb() -> bool:
    global _xvfb
    if _xvfb is None:
        d = os.environ.get("DISPLAY", "")
        n = d.split(":")[1].split(".")[0] if ":" in d else ""
        _xvfb = bool(n and subprocess.run(
            ["pgrep", "-f", f"Xvfb.*:{n}"], capture_output=True).returncode == 0)
    return _xvfb


def launch(params: dict) -> tuple[dict, int]:
    app = params.get("app")
    if not app:
        return {"error": "app required"}, 400
    candidates = [app, app.lower(), app.lower().replace(" ", "-")]
    base = app.lower().replace(" ", "-")
    if base in _XVFB_PREFER and _on_xvfb():
        candidates = list(_XVFB_PREFER[base]) + candidates
    candidates.extend(_ALIASES.get(base, []))
    for name in dict.fromkeys(candidates):
        try:
            extra = _CHROME_ARGS if name in _CHROME_NAMES else []
            if name in _CHROME_NAMES:
                _patch_chrome_prefs()
            subprocess.Popen([name] + extra, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            return {"launched": name}, 200
        except FileNotFoundError:
            continue
    return {"error": f"could not find executable for '{app}'"}, 404

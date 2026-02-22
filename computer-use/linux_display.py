"""Display handlers for Linux: screenshot, windows, apps, focus, launch."""
from __future__ import annotations

import logging
import os
import subprocess

logger = logging.getLogger(__name__)
_ENV = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":99")}

def _run(args, timeout=5):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=_ENV)
    return r.stdout.strip()


def screen_size() -> tuple[int, int]:
    try:
        out = _run(["xdpyinfo"])
        for line in out.splitlines():
            if "dimensions:" in line:
                w, h = line.split()[1].split("x")
                return int(w), int(h)
    except (subprocess.SubprocessError, FileNotFoundError, ValueError):
        pass
    try:
        out = _run(["xrandr", "--current"])
        for line in out.splitlines():
            if " connected" in line:
                for part in line.split():
                    if "x" in part and "+" in part:
                        w, h = part.split("+")[0].split("x")
                        return int(w), int(h)
    except (subprocess.SubprocessError, FileNotFoundError, ValueError):
        pass
    return 1920, 1080

def screenshot(params: dict) -> tuple[dict, int]:
    path = params.get("path", "/tmp/claude-screenshot.png")
    x, y = params.get("x"), params.get("y")
    w, h = params.get("w"), params.get("h")

    if x is not None and y is not None and w is not None and h is not None:
        _run(["scrot", "-o", path])
        crop = f"{int(w)}x{int(h)}+{int(x)}+{int(y)}"
        _run(["convert", path, "-crop", crop, "+repage", path])
        return {"path": path, "width": int(w), "height": int(h),
                "crop": {"x": x, "y": y, "w": w, "h": h}}, 200

    _run(["scrot", "-o", path])

    ix, iy = params.get("indicator_x"), params.get("indicator_y")
    if ix is not None and iy is not None:
        _run(["convert", path,
              "-fill", "none", "-stroke", "red", "-strokewidth", "3",
              "-draw", f"circle {int(ix)},{int(iy)} {int(ix)+18},{int(iy)}",
              "-fill", "red", "-stroke", "none",
              "-draw", f"circle {int(ix)},{int(iy)} {int(ix)+3},{int(iy)}",
              path])

    sw, sh = screen_size()
    return {"path": path, "width": sw, "height": sh}, 200

def windows(_params: dict) -> tuple[dict, int]:
    wins = []
    wm_classes: dict[str, str] = {}
    try:
        xout = _run(["wmctrl", "-l", "-x"])
        for line in xout.splitlines():
            parts = line.split(None, 3)
            if len(parts) >= 3:
                wm_classes[parts[0]] = parts[2].split(".")[0]
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    try:
        out = _run(["wmctrl", "-l", "-G", "-p"])
        for line in out.splitlines():
            parts = line.split(None, 8)
            if len(parts) >= 8:
                wid = parts[0]
                x, y, w, h = int(parts[3]), int(parts[4]), int(parts[5]), int(parts[6])
                title = parts[8] if len(parts) > 8 else ""
                app_name = wm_classes.get(wid, "")
                wins.append({"id": wid, "title": title, "app": app_name,
                             "frame": {"x": x, "y": y, "w": w, "h": h},
                             "focused": False})
    except (subprocess.SubprocessError, FileNotFoundError, ValueError):
        logger.debug("wmctrl not available or failed")
    try:
        active = _run(["xdotool", "getactivewindow"])
        active_int = int(active)
        for w in wins:
            if int(w["id"], 16) == active_int:
                w["focused"] = True
    except (subprocess.SubprocessError, FileNotFoundError, ValueError):
        pass
    return {"windows": wins}, 200


def apps(_params: dict) -> tuple[dict, int]:
    result, seen = [], set()
    try:
        for line in _run(["wmctrl", "-l", "-p"]).splitlines():
            parts = line.split(None, 4)
            if len(parts) < 5: continue
            pid = int(parts[2]) if parts[2] != "0" else 0
            name = parts[4]
            if pid:
                try: name = _run(["ps", "-p", str(pid), "-o", "comm="])
                except (subprocess.SubprocessError, FileNotFoundError): pass
            if name not in seen:
                seen.add(name); result.append({"name": name, "pid": pid})
    except (subprocess.SubprocessError, FileNotFoundError, ValueError): pass
    return {"apps": result}, 200


def focus(params: dict) -> tuple[dict, int]:
    app = params.get("app")
    window_id = params.get("window_id")
    pid = params.get("pid")
    if window_id:
        _run(["wmctrl", "-i", "-a", str(window_id)])
        return {"focused": window_id}, 200
    if pid:
        try:
            for line in _run(["wmctrl", "-l", "-p"]).splitlines():
                parts = line.split(None, 4)
                if len(parts) >= 3 and parts[2] == str(pid):
                    _run(["wmctrl", "-i", "-a", parts[0]])
                    return {"focused": f"pid:{pid}"}, 200
        except (subprocess.SubprocessError, FileNotFoundError):
            pass
    if not app:
        return {"error": "app, window_id, or pid required"}, 400
    try:
        for line in _run(["wmctrl", "-l", "-x"]).splitlines():
            if app.lower() in line.lower():
                _run(["wmctrl", "-i", "-a", line.split()[0]])
                return {"focused": app}, 200
    except (subprocess.SubprocessError, FileNotFoundError): pass
    return {"error": "not found"}, 404

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

def _patch_chrome_prefs() -> None:
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
        _xvfb = bool(n and subprocess.run(["pgrep", "-f", f"Xvfb.*:{n}"], capture_output=True).returncode == 0)
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
            if name in _CHROME_NAMES: _patch_chrome_prefs()
            subprocess.Popen([name] + extra, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            return {"launched": name}, 200
        except FileNotFoundError: continue
    return {"error": f"could not find executable for '{app}'"}, 404

"""Linux window management via xdotool/wmctrl."""
from __future__ import annotations

import subprocess


def window_manage(params: dict) -> tuple[dict, int]:
    action = params.get("action")
    if not action:
        return {"error": "action required"}, 400
    app = params.get("app")
    # Get target window ID
    try:
        if app:
            wid = subprocess.run(
                ["xdotool", "search", "--name", app],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip().split("\n")[0]
        else:
            wid = subprocess.run(
                ["xdotool", "getactivewindow"],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip()
        if not wid:
            return {"error": "no window found"}, 404
    except (FileNotFoundError, IndexError):
        return {"error": "xdotool not installed or no window"}, 500
    actions = {
        "maximize": ["wmctrl", "-i", "-r", wid, "-b", "add,maximized_vert,maximized_horz"],
        "minimize": ["xdotool", "windowminimize", wid],
        "restore": ["wmctrl", "-i", "-r", wid, "-b", "remove,maximized_vert,maximized_horz"],
        "fullscreen": ["wmctrl", "-i", "-r", wid, "-b", "toggle,fullscreen"],
    }
    if action in actions:
        subprocess.run(actions[action], timeout=5)
        return {"ok": True, "action": action, "window_id": wid}, 200
    elif action == "resize":
        w, h = params.get("w"), params.get("h")
        if not w or not h:
            return {"error": "w and h required"}, 400
        subprocess.run(["xdotool", "windowsize", wid, str(w), str(h)], timeout=5)
        return {"ok": True, "action": "resize", "w": w, "h": h}, 200
    elif action == "move":
        x, y = params.get("x"), params.get("y")
        if x is None or y is None:
            return {"error": "x and y required"}, 400
        subprocess.run(["xdotool", "windowmove", wid, str(x), str(y)], timeout=5)
        return {"ok": True, "action": "move", "x": x, "y": y}, 200
    return {"error": f"unknown action: {action}"}, 400

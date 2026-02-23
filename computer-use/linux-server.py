#!/usr/bin/env python3
"""Linux computer-use HTTP server — drop-in replacement for Hammerspoon.

Same API on port 8097, backed by xdotool + scrot + pyatspi2.
Install: apt install xdotool scrot wmctrl imagemagick python3-pyatspi at-spi2-core
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

import linux_input as inp
import linux_held_input as held
import linux_display as display
import linux_a11y as a11y


def clipboard_read(_params: dict) -> tuple[dict, int]:
    try:
        text = subprocess.run(
            ["xclip", "-selection", "clipboard", "-o"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        return {"text": text}, 200
    except FileNotFoundError:
        return {"error": "xclip not installed"}, 500


def clipboard_write(params: dict) -> tuple[dict, int]:
    text = params.get("text")
    if text is None:
        return {"error": "text required"}, 400
    try:
        subprocess.run(
            ["xclip", "-selection", "clipboard"],
            input=text, text=True, timeout=5, check=True,
        )
        return {"ok": True, "length": len(text)}, 200
    except FileNotFoundError:
        return {"error": "xclip not installed"}, 500

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


PORT = int(os.environ.get("HAMMERSPOON_PORT", "8097"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _respond(self, body: dict, code: int = 200):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def do_GET(self):
        routes = {
            "/health": lambda _: ({"status": "ok", "platform": "linux"}, 200),
            "/windows": display.windows,
            "/apps": display.apps,
            "/clipboard": clipboard_read,
        }
        handler = routes.get(self.path)
        if handler:
            try:
                body, code = handler({})
            except Exception as e:
                body, code = {"error": str(e)}, 500
            self._respond(body, code)
        else:
            self._respond({"error": "not found", "path": self.path}, 404)

    def do_POST(self):
        params = self._read_body()
        routes = {
            "/screenshot": display.screenshot,
            "/click": inp.click,
            "/type": inp.type_input,
            "/drag": inp.drag,
            "/scroll": inp.scroll,
            "/key_down": held.key_down,
            "/key_up": held.key_up,
            "/mouse_down": held.mouse_down,
            "/mouse_up": held.mouse_up,
            "/mouse_move": held.mouse_move,
            "/release_all": held.release_all,
            "/input_sequence": held.input_sequence,
            "/type_from_file": inp.type_from_file,
            "/focus": display.focus,
            "/launch": display.launch,
            "/element_at": a11y.element_at,
            "/accessibility": a11y.accessibility_tree,
            "/ax_press": a11y.ax_press,
            "/clipboard": clipboard_write,
            "/window_manage": window_manage,
            "/reload": lambda _: ({"status": "ok", "note": "no-op on linux"}, 200),
        }
        handler = routes.get(self.path)
        if handler:
            try:
                body, code = handler(params)
            except Exception as e:
                body, code = {"error": str(e)}, 500
            self._respond(body, code)
        else:
            self._respond({"error": "not found", "path": self.path}, 404)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Linux computer-use API on localhost:{PORT}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

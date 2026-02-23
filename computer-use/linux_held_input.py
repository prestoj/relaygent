"""Held input handlers for Linux: key_down/up, mouse_down/up, mouse_move, release_all, input_sequence.

Extracted from linux_input.py to keep it under 200 lines.
"""
from __future__ import annotations

import threading

from linux_input import _xdotool, _mod_flags, KEY_MAP


def key_down(params: dict) -> tuple[dict, int]:
    key = params.get("key")
    if not key:
        return {"error": "key required"}, 400
    xkey = KEY_MAP.get(key.lower(), key)
    mods = _mod_flags(params.get("modifiers"))
    for m in mods:
        _xdotool("keydown", m)
    _xdotool("keydown", xkey)
    label = ("+".join(mods) + "+" if mods else "") + key
    return {"held": label}, 200

def key_up(params: dict) -> tuple[dict, int]:
    key = params.get("key")
    if not key:
        return {"error": "key required"}, 400
    xkey = KEY_MAP.get(key.lower(), key)
    mods = _mod_flags(params.get("modifiers"))
    _xdotool("keyup", xkey)
    for m in reversed(mods):
        _xdotool("keyup", m)
    label = ("+".join(mods) + "+" if mods else "") + key
    return {"released": label}, 200


def mouse_down(params: dict) -> tuple[dict, int]:
    btn = str(params.get("button", 1))
    if params.get("x") is not None and params.get("y") is not None:
        _xdotool("mousemove", "--sync", str(int(params["x"])), str(int(params["y"])))
    _xdotool("mousedown", btn)
    return {"held": f"mouse{btn}"}, 200

def mouse_up(params: dict) -> tuple[dict, int]:
    btn = str(params.get("button", 1))
    if params.get("x") is not None and params.get("y") is not None:
        _xdotool("mousemove", "--sync", str(int(params["x"])), str(int(params["y"])))
    _xdotool("mouseup", btn)
    return {"released": f"mouse{btn}"}, 200

def mouse_move(params: dict) -> tuple[dict, int]:
    x, y = params.get("x"), params.get("y")
    if x is None or y is None:
        return {"error": "x,y required"}, 400
    _xdotool("mousemove", "--sync", str(int(x)), str(int(y)))
    return {"moved": {"x": int(x), "y": int(y)}}, 200

_RELEASE_KEYS = "Up Down Left Right space Return shift ctrl alt".split() + list("abcdefghijklmnopqrstuvwxyz")


def release_all(_params: dict) -> tuple[dict, int]:
    for key in _RELEASE_KEYS:
        try: _xdotool("keyup", key)
        except Exception: pass
    for btn in "1", "2", "3":
        try: _xdotool("mouseup", btn)
        except Exception: pass
    return {"released": "all", "count": len(_RELEASE_KEYS) + 3}, 200

def input_sequence(params: dict) -> tuple[dict, int]:
    actions = params.get("actions", [])
    if not actions:
        return {"error": "actions array required"}, 400
    dispatch = {"key_down": key_down, "key_up": key_up, "mouse_down": mouse_down,
                "mouse_up": mouse_up, "mouse_move": mouse_move, "release_all": release_all,
                "key_press": lambda a: (key_down(a), key_up(a))}
    for a in actions:
        fn = dispatch.get(a.get("action"))
        if not fn: continue
        delay = (a.get("delay") or 0) / 1000.0
        if delay > 0: threading.Timer(delay, fn, args=[a]).start()
        else: fn(a)
    return {"queued": len(actions), "duration_ms": max((a.get("delay") or 0) for a in actions)}, 200

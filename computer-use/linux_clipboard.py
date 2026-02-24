"""Linux clipboard operations via xclip."""
from __future__ import annotations

import subprocess


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

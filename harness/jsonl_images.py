"""JSONL image stripping — removes old base64 screenshots to save context.

Extracted from jsonl_checks.py. Used by process.py before resuming sessions.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from config import log
from jsonl_checks import find_jsonl_path


def _atomic_rewrite(path: Path, lines: list[str]) -> None:
    """Rewrite `path` atomically: write a sibling temp file then os.replace it in.

    The naive `open(path, "w")` truncates the real JSONL up front, so a crash or
    SIGKILL mid-write (this runs just before resume, near process teardown) would
    leave the resumable session file truncated/corrupted. os.replace is atomic on
    POSIX, so a failure leaves the original wholly intact.
    """
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.writelines(lines)
        os.replace(tmp, path)
    except OSError:
        try: os.unlink(tmp)
        except OSError: pass
        raise


def _has_image(line: str) -> bool:
    """Return True if a JSONL line contains a tool_result with an image."""
    try:
        entry = json.loads(line)
        for item in entry.get("message", {}).get("content", []) or []:
            if not isinstance(item, dict) or item.get("type") != "tool_result": continue
            sub = item.get("content", [])
            if isinstance(sub, list) and any(isinstance(s, dict) and s.get("type") == "image" for s in sub):
                return True
    except (json.JSONDecodeError, AttributeError): pass
    return False


def _strip_images_from_line(line: str) -> str:
    """Replace image items in a JSONL line with placeholder text. Returns new line."""
    try:
        entry = json.loads(line)
        for item in entry.get("message", {}).get("content", []) or []:
            if not isinstance(item, dict) or item.get("type") != "tool_result": continue
            sub = item.get("content", [])
            if not isinstance(sub, list): continue
            item["content"] = [
                {"type": "text", "text": "[screenshot removed]"} if isinstance(s, dict) and s.get("type") == "image" else s
                for s in sub]
        return json.dumps(entry) + "\n"
    except (json.JSONDecodeError, AttributeError):
        return line


def strip_old_images(session_id: str, workspace: Path, keep_last: int = 5) -> int:
    """Strip base64 images from all but the last `keep_last` tool_result images.

    Rewrites the JSONL in place. Returns number of images stripped.
    """
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists(): return 0
    try:
        with open(jsonl) as f: lines = f.readlines()
        img_indices = [i for i, l in enumerate(lines) if _has_image(l)]
        to_strip = set(img_indices[:-keep_last]) if len(img_indices) > keep_last else set()
        if not to_strip: return 0
        new_lines = [_strip_images_from_line(l) if i in to_strip else l for i, l in enumerate(lines)]
        _atomic_rewrite(jsonl, new_lines)
        return len(to_strip)
    except OSError: return 0


def strip_all_images(session_id: str, workspace: Path) -> int:
    """Strip ALL base64 images from the JSONL — used for bad-image recovery.

    Rewrites the JSONL in place. Returns number of images stripped.
    """
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists(): return 0
    try:
        with open(jsonl) as f: lines = f.readlines()
        img_indices = [i for i, l in enumerate(lines) if _has_image(l)]
        if not img_indices: return 0
        to_strip = set(img_indices)
        new_lines = [_strip_images_from_line(l) if i in to_strip else l for i, l in enumerate(lines)]
        _atomic_rewrite(jsonl, new_lines)
        return len(to_strip)
    except OSError: return 0

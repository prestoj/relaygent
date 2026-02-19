"""JSONL session file inspection utilities for the relay harness.

These functions read Claude's session JSONL files to detect:
- Incomplete exits (Claude crashed mid-conversation)
- Whether Claude finished communicating (for sleep decisions)
- Context window fill percentage
"""

from __future__ import annotations

import json
from pathlib import Path

from config import CONTEXT_WINDOW, log


def find_jsonl_path(session_id: str, workspace: Path) -> Path | None:
    """Find the jsonl file for a session."""
    claude_dir = Path.home() / ".claude" / "projects"
    # Claude CLI replaces both '/' and '.' with '-' when computing the project slug
    workspace_slug = str(workspace).replace("/", "-").replace(".", "-")
    project_dir = claude_dir / workspace_slug
    if project_dir.exists():
        jsonl = project_dir / f"{session_id}.jsonl"
        if jsonl.exists():
            return jsonl
    return None


def get_jsonl_size(session_id: str, workspace: Path) -> int:
    """Get current size of session jsonl file."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        return 0
    try:
        return jsonl.stat().st_size
    except OSError:
        return 0


def _read_tail(jsonl: Path, bytes_count: int = 65536) -> list[str]:
    """Read last N bytes of a JSONL file and return complete lines."""
    try:
        with open(jsonl, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            if size == 0:
                return []
            offset = max(0, size - bytes_count)
            f.seek(offset)
            if offset > 0:
                f.readline()  # Skip partial first line after seeking mid-file
            data = f.read().decode('utf-8', errors='replace')
            return [l for l in data.strip().split('\n') if l.strip()]
    except OSError:
        return []


def check_incomplete_exit(session_id: str, workspace: Path) -> tuple[bool, str]:
    """Check if Claude exited mid-conversation. Returns (incomplete, last_tool)."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl:
        return False, ""
    try:
        lines = _read_tail(jsonl)
        if not lines:
            return False, ""

        last_entry = json.loads(lines[-1])
        if last_entry.get("type") == "user":
            content = last_entry.get("message", {}).get("content", [])
            if content and isinstance(content, list):
                for item in content:
                    if item.get("type") == "tool_result":
                        return True, item.get("tool_use_id", "unknown tool")
            return True, ""
        return False, ""
    except (OSError, json.JSONDecodeError, KeyError):
        return False, ""


def should_sleep(session_id: str, workspace: Path) -> bool:
    """Check if Claude finished communicating before exiting.

    Only return True if Claude wrote text output (not just tool calls).
    This prevents sleeping when Claude crashes/exits mid-conversation.
    """
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        log("Should sleep? No - JSONL not found")
        return False

    try:
        lines = _read_tail(jsonl)
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                if entry.get("type") == "assistant":
                    content = entry.get("message", {}).get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                log("Should sleep? Yes - Claude wrote text output")
                                return True
                    log("Should sleep? No - last assistant message has no text")
                    return False
                if entry.get("type") == "user":
                    log("Should sleep? No - last message is tool result")
                    return False
            except json.JSONDecodeError:
                continue
        return False
    except Exception as e:
        log(f"WARNING: should_sleep check failed: {e}")
        return False


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
        with open(jsonl, "w") as f: f.writelines(new_lines)
        return len(to_strip)
    except OSError: return 0


def get_context_fill_from_jsonl(session_id: str, workspace: Path) -> float:
    """Get context fill percentage by parsing JSONL usage data."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        return 0.0
    try:
        lines = _read_tail(jsonl)
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                if entry.get("type") == "assistant":
                    usage = entry.get("message", {}).get("usage", {})
                    if usage:
                        total = (usage.get("input_tokens", 0)
                                + usage.get("output_tokens", 0)
                                + usage.get("cache_creation_input_tokens", 0)
                                + usage.get("cache_read_input_tokens", 0))
                        return total / CONTEXT_WINDOW * 100
            except json.JSONDecodeError:
                continue
        return 0.0
    except Exception as e:
        log(f"WARNING: context fill check failed: {e}")
        return 0.0

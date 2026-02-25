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
    """Check if Claude exited mid-conversation. Returns (incomplete, last_tool_name)."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl: return False, ""
    try:
        lines = _read_tail(jsonl)
        if not lines: return False, ""
        last_entry = json.loads(lines[-1])
        if last_entry.get("type") == "user":
            content = last_entry.get("message", {}).get("content", [])
            has_tool_result = False
            if content and isinstance(content, list):
                for item in content:
                    if item.get("type") == "tool_result":
                        has_tool_result = True
                        break
            if not has_tool_result and not content:
                return True, ""
            if not has_tool_result:
                return True, ""
            # Find tool name from preceding assistant message
            tool_name = "unknown"
            for line in reversed(lines[:-1]):
                try:
                    entry = json.loads(line)
                    if entry.get("type") == "assistant":
                        for item in entry.get("message", {}).get("content", []):
                            if isinstance(item, dict) and item.get("type") == "tool_use":
                                tool_name = item.get("name", "unknown")
                        break
                except (json.JSONDecodeError, KeyError):
                    continue
            return True, tool_name
        return False, ""
    except (OSError, json.JSONDecodeError, KeyError): return False, ""


def should_sleep(session_id: str, workspace: Path) -> bool:
    """Check if Claude finished communicating before exiting.

    Only return True if Claude wrote text output (not just tool calls).
    This prevents sleeping when Claude crashes/exits mid-conversation.
    """
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists(): log("Should sleep? No - JSONL not found"); return False
    try:
        lines = _read_tail(jsonl)
        for line in reversed(lines):
            if not line.strip(): continue
            try: entry = json.loads(line)
            except json.JSONDecodeError: continue
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
        return False
    except Exception as e:
        log(f"WARNING: should_sleep check failed: {e}")
        return False


def last_output_is_idle(session_id: str, workspace: Path, max_chars: int = 280) -> bool:
    """True if Claude's last output was short text with no tool calls (idle/conversational).

    Returns False if the sleep MCP tool was called recently (intentional sleep, not idle).
    """
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl: return False
    try:
        lines = _read_tail(jsonl)
        # Check last few assistant messages for sleep tool call
        assistant_count = 0
        for line in reversed(lines):
            if not line.strip(): continue
            try: e = json.loads(line)
            except json.JSONDecodeError: continue
            if e.get("type") != "assistant": continue
            assistant_count += 1
            c = e.get("message", {}).get("content") or []
            has_tool = any(isinstance(x, dict) and x.get("type") == "tool_use" for x in c)
            has_sleep = any(isinstance(x, dict) and x.get("type") == "tool_use"
                           and "sleep" in (x.get("name") or "") for x in c)
            if has_sleep:
                return False  # Intentional sleep — not idle
            if assistant_count == 1:
                text = "".join(x.get("text", "") for x in c
                               if isinstance(x, dict) and x.get("type") == "text")
                is_idle = not has_tool and len(text.strip()) < max_chars
            if assistant_count >= 3:
                break
        return is_idle if assistant_count >= 1 else False
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        pass
    return False


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

"""Generate a compact summary of a completed session from its JSONL log.

Parses tool usage, file modifications, and token usage. Saved to
data/last-session-summary.json for orient.sh to display on next startup.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from config import CONTEXT_WINDOW, REPO_DIR, log
from jsonl_checks import find_jsonl_path

SUMMARY_FILE = REPO_DIR / "data" / "last-session-summary.json"


def generate_summary(session_id: str, workspace: Path) -> dict | None:
    """Parse a session's JSONL and return a summary dict."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        return None
    tools = Counter()
    files_modified = set()
    git_commits = 0
    prs_created = []
    prs_merged = []
    turns = 0
    total_tokens = 0
    context_pct = 0.0
    try:
        with open(jsonl) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("type") != "assistant":
                    continue
                turns += 1
                msg = entry.get("message", {})
                usage = msg.get("usage", {})
                if usage:
                    total_tokens = (
                        usage.get("input_tokens", 0)
                        + usage.get("output_tokens", 0)
                        + usage.get("cache_creation_input_tokens", 0)
                        + usage.get("cache_read_input_tokens", 0)
                    )
                    context_pct = total_tokens / CONTEXT_WINDOW * 100
                for item in msg.get("content", []):
                    if not isinstance(item, dict):
                        continue
                    if item.get("type") != "tool_use":
                        continue
                    name = item.get("name", "unknown")
                    tools[name] += 1
                    inp = item.get("input", {})
                    if name in ("Edit", "Write", "Read") and "file_path" in inp:
                        files_modified.add(inp["file_path"])
                    if name == "Bash":
                        cmd = inp.get("command", "")
                        if "git commit" in cmd:
                            git_commits += 1
                        if "gh pr create" in cmd:
                            m = re.search(r'--title\s+["\']([^"\']+)', cmd)
                            prs_created.append(m.group(1)[:60] if m else "PR")
                        if "gh pr merge" in cmd:
                            m = re.search(r'merge\s+(\d+)', cmd)
                            prs_merged.append(int(m.group(1)) if m else 0)
        if turns == 0:
            return None
        return {
            "session_id": session_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "turns": turns,
            "tools": dict(tools.most_common(10)),
            "files_modified": sorted(files_modified)[:20],
            "git_commits": git_commits,
            "prs_created": prs_created,
            "prs_merged": prs_merged,
            "context_pct": round(context_pct, 1),
            "total_tokens": total_tokens,
        }
    except Exception as e:
        log(f"WARNING: session summary failed: {e}")
        return None


def save_summary(session_id: str, workspace: Path) -> None:
    """Generate and save session summary to last-session-summary.json."""
    summary = generate_summary(session_id, workspace)
    if not summary:
        return
    try:
        SUMMARY_FILE.write_text(json.dumps(summary, indent=2))
        log(f"Session summary: {summary['turns']} turns, "
            f"{summary['context_pct']:.0f}% context")
    except Exception as e:
        log(f"WARNING: failed to save session summary: {e}")

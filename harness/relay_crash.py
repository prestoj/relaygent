"""Crash context persistence for relay harness."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from config import LOG_FILE, REPO_DIR, log

CRASH_CONTEXT_FILE = REPO_DIR / "data" / "crash-context.json"


def write_crash_context(exit_code: int, crash_count: int, session_id: str) -> None:
    """Save crash info so the next session knows what happened."""
    try:
        last_lines: list[str] = []
        if LOG_FILE.exists():
            lines = LOG_FILE.read_text().strip().split("\n")
            last_lines = lines[-5:]
        CRASH_CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
        CRASH_CONTEXT_FILE.write_text(json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "exit_code": exit_code,
            "crash_count": crash_count,
            "session_id": session_id,
            "last_log_lines": last_lines,
        }, indent=2))
    except OSError as e:
        log(f"Could not write crash context: {e}")


def clear_crash_context() -> None:
    """Remove crash context file after successful session."""
    try:
        if CRASH_CONTEXT_FILE.exists():
            CRASH_CONTEXT_FILE.unlink()
    except OSError:
        pass

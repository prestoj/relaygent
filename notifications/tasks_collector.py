"""Relaygent Notifications — overdue task collector.

Reads tasks.md and surfaces overdue recurring tasks as notifications.
Deduplicates using a JSON sidecar so the agent is only woken once per
freq period per task (not on every poll while the task stays overdue).
"""

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path

from notif_config import DATA_DIR

logger = logging.getLogger(__name__)

FREQ_HOURS = {"6h": 6, "12h": 12, "daily": 24, "2d": 48, "3d": 72, "weekly": 168, "monthly": 720}
NOTIFIED_FILE = Path(DATA_DIR) / "task-notified.json"


def _freq_ms(freq):
    return FREQ_HOURS.get(freq, 24) * 3600000


def _parse_task_line(line):
    m = re.match(r'^-\s+\[([x ])\]\s+(.+)$', line, re.IGNORECASE)
    if not m:
        return None
    parts = m.group(2).split("|")
    meta = {}
    for p in parts[1:]:
        kv = re.match(r'^(\w+):\s*(.+)$', p.strip())
        if kv:
            meta[kv.group(1)] = kv.group(2).strip()
    return {
        "description": parts[0].strip(),
        "type": meta.get("type", "one-off"),
        "freq": meta.get("freq", ""),
        "last": meta.get("last", ""),
    }


def _load_notified():
    try:
        return json.loads(NOTIFIED_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save_notified(data):
    try:
        tmp = str(NOTIFIED_FILE) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, NOTIFIED_FILE)
    except OSError:
        logger.warning("Failed to save task-notified.json")


def collect(notifications):
    """Add overdue recurring tasks to notifications list."""
    kb_dir = os.environ.get("RELAYGENT_KB_DIR", "")
    if not kb_dir:
        return

    tasks_file = Path(kb_dir) / "tasks.md"
    try:
        raw = tasks_file.read_text()
    except OSError:
        return

    now = datetime.now()
    now_ms = now.timestamp() * 1000
    notified = _load_notified()
    updated = False

    for line in raw.splitlines():
        t = _parse_task_line(line)
        if not t or t["type"] != "recurring" or not t["freq"]:
            continue

        last = t["last"]
        if not last or last == "never":
            next_due = datetime.fromtimestamp(0)
        else:
            try:
                last_ms = datetime.fromisoformat(last).timestamp() * 1000
                next_due = datetime.fromtimestamp((last_ms + _freq_ms(t["freq"])) / 1000)
            except (ValueError, OSError):
                continue

        if next_due > now:
            continue  # not overdue

        # Dedup: only notify if we haven't notified within one freq period
        desc = t["description"]
        freq_ms = _freq_ms(t["freq"])
        last_notified_ms = notified.get(desc, 0)
        if now_ms - last_notified_ms < freq_ms:
            continue

        mins_late = int((now - next_due).total_seconds() / 60)
        if mins_late < 60:
            overdue_str = f"{mins_late}m overdue"
        elif mins_late < 1440:
            overdue_str = f"{round(mins_late / 60)}h overdue"
        else:
            overdue_str = f"{round(mins_late / 1440)}d overdue"

        notifications.append({
            "type": "task",
            "description": desc,
            "freq": t["freq"],
            "overdue": overdue_str,
            "last": last,
        })
        notified[desc] = now_ms
        updated = True

    if updated:
        _save_notified(notified)

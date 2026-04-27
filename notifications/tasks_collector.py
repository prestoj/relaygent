"""Surface due recurring tasks from tasks.md as notifications.

Schedules: `freq:` coarse (6h..monthly) or `cron:` precise (5-field, local time).
Optional `runbook:` points at a self-contained prompt file.

Cron-path dedup via a sticky window: once a firing is seen, the task keeps
appearing on every poll for STICKY_SECONDS (so wake loop + hook reliably see
it), then `last:` is advanced in tasks.md and emission stops until next fire.
"""

import json
import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

from notif_config import DATA_DIR

try:
    from croniter import croniter
except ImportError:
    croniter = None

logger = logging.getLogger(__name__)

FREQ_HOURS = {"6h": 6, "12h": 12, "daily": 24, "2d": 48, "3d": 72, "weekly": 168, "monthly": 720}
NOTIFIED_FILE = Path(DATA_DIR) / "task-notified.json"
STICKY_SECONDS = 5 * 60


def _freq_ms(freq): return FREQ_HOURS.get(freq, 24) * 3600000


def _parse_task_line(line):
    m = re.match(r'^-\s+\[([x ])\]\s+(.+)$', line, re.IGNORECASE)
    if not m: return None
    parts = m.group(2).split("|")
    meta = {}
    for p in parts[1:]:
        kv = re.match(r'^(\w+):\s*(.+)$', p.strip())
        if kv: meta[kv.group(1)] = kv.group(2).strip().strip('"').strip("'")
    return {"description": parts[0].strip(), "type": meta.get("type", "one-off"),
            "freq": meta.get("freq", ""), "cron": meta.get("cron", ""),
            "last": meta.get("last", ""), "runbook": meta.get("runbook", "")}


def _load_notified():
    try: return json.loads(NOTIFIED_FILE.read_text())
    except (OSError, json.JSONDecodeError): return {}


def _save_notified(data):
    try:
        tmp = str(NOTIFIED_FILE) + ".tmp"
        with open(tmp, "w") as f: json.dump(data, f)
        os.replace(tmp, NOTIFIED_FILE)
    except OSError: logger.warning("Failed to save task-notified.json")


def _last_cron_fire(cron_expr, last_dt, now_dt):
    if croniter is None: return None
    try: it = croniter(cron_expr, last_dt)
    except Exception: return None
    latest = None
    while True:
        nxt = it.get_next(datetime)
        if nxt > now_dt: break
        latest = nxt
    return latest


def _rewrite_last(tasks_file, desc, new_last):
    """Update a task's `last:` field in-place, preserving other metadata order."""
    try: text = tasks_file.read_text()
    except OSError: return
    out = []
    for line in text.splitlines():
        t = _parse_task_line(line)
        if t and t["description"] == desc and t["type"] == "recurring":
            head, _, meta_str = line.partition("|")
            parts, saw = [], False
            for p in meta_str.split("|") if meta_str else []:
                kv = re.match(r'^\s*(\w+):\s*(.+)\s*$', p)
                if not kv: continue
                k, v = kv.group(1), kv.group(2).strip()
                if k == "last":
                    parts.append(f"last: {new_last}"); saw = True
                else:
                    parts.append(f"{k}: {v}")
            if not saw: parts.append(f"last: {new_last}")
            line = head.rstrip() + " | " + " | ".join(parts)
        out.append(line)
    tasks_file.write_text("\n".join(out) + ("\n" if text.endswith("\n") else ""))


def _fmt_overdue(seconds):
    mins = int(seconds / 60)
    if mins < 60: return f"{mins}m overdue"
    if mins < 1440: return f"{round(mins / 60)}h overdue"
    return f"{round(mins / 1440)}d overdue"


def _parse_dt(s):
    try: return datetime.fromisoformat(s)
    except ValueError:
        try: return datetime.strptime(s, "%Y-%m-%d %H:%M")
        except ValueError: return None


def _cron_task(t, tasks_file, notified, now, now_ms):
    """Cron-scheduled task. `last: never` → seed to now so only future
    firings count (avoids a new task reading as "24h overdue")."""
    last = t["last"]; desc = t["description"]; expr = t["cron"]
    if not last or last == "never":
        _rewrite_last(tasks_file, desc, now.strftime("%Y-%m-%d %H:%M"))
        return None, False
    last_dt = _parse_dt(last)
    fire_dt = _last_cron_fire(expr, last_dt, now) if last_dt else None

    sticky = notified.get(desc) or {}
    if not isinstance(sticky, dict): sticky = {}
    sticky_fired = sticky.get("fired_at")
    sticky_ms = sticky.get("first_emit_ms", 0)

    if not fire_dt:
        if desc in notified:
            del notified[desc]
            return None, False
        return None, False

    fired_str = fire_dt.strftime("%Y-%m-%d %H:%M")
    if sticky_fired != fired_str:
        notified[desc] = {"first_emit_ms": now_ms, "fired_at": fired_str}
        return fire_dt, True
    if now_ms - sticky_ms < STICKY_SECONDS * 1000:
        return fire_dt, True
    # sticky window done — advance last:, stop emitting
    _rewrite_last(tasks_file, desc, fired_str)
    del notified[desc]
    return None, False


def _freq_task(t, tasks_file, notified, now, now_ms):
    """Handle coarse-freq task. Returns (fire_dt_or_None, should_emit)."""
    last = t["last"]; desc = t["description"]; freq = t["freq"]
    if not last or last == "never":
        fire_dt = now
    else:
        last_dt = _parse_dt(last)
        if not last_dt: return None, False
        next_due = last_dt + timedelta(milliseconds=_freq_ms(freq))
        if next_due > now: return None, False
        fire_dt = next_due
    last_notified_ms = notified.get(desc, 0)
    if isinstance(last_notified_ms, dict):
        last_notified_ms = last_notified_ms.get("first_emit_ms", 0)
    if now_ms - last_notified_ms < _freq_ms(freq):
        return None, False
    notified[desc] = now_ms
    # Advance last: so tasks.md shows a real firing time, not a stale "never".
    _rewrite_last(tasks_file, desc, fire_dt.strftime("%Y-%m-%d %H:%M"))
    return fire_dt, True


def collect(notifications):
    kb_dir = os.environ.get("RELAYGENT_KB_DIR", "")
    if not kb_dir: return
    tasks_file = Path(kb_dir) / "tasks.md"
    try: raw = tasks_file.read_text()
    except OSError: return
    now = datetime.now()
    now_ms = now.timestamp() * 1000
    notified = _load_notified()
    before = json.dumps(notified, sort_keys=True)

    for line in raw.splitlines():
        t = _parse_task_line(line)
        if not t or t["type"] != "recurring": continue
        if not (t["cron"] or t["freq"]): continue
        if t["cron"]:
            fire_dt, emit = _cron_task(t, tasks_file, notified, now, now_ms)
        else:
            fire_dt, emit = _freq_task(t, tasks_file, notified, now, now_ms)
        if not emit: continue
        overdue = _fmt_overdue((now - fire_dt).total_seconds()) if fire_dt < now else "first run"
        notifications.append({
            "type": "task",
            "description": t["description"],
            "overdue": overdue,
            "last": t["last"],
            "freq": t["freq"],
            "runbook": t["runbook"],
            "fired_at": fire_dt.strftime("%Y-%m-%d %H:%M"),
            "timestamp": f"task-{t['description']}-{fire_dt.strftime('%Y-%m-%d %H:%M')}",
        })

    if json.dumps(notified, sort_keys=True) != before:
        _save_notified(notified)

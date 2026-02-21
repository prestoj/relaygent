#!/usr/bin/env python3
"""Parse relay log and display session statistics."""

import json
import re
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent
LOG_FILE = SCRIPT_DIR.parent / "logs" / "relaygent.log"
STATUS_FILE = Path.home() / ".relaygent" / "relay-status.json"
PCT_FILE = Path("/tmp/relaygent-context-pct")

C = {"cyan": "\033[0;36m", "green": "\033[0;32m", "yellow": "\033[1;33m",
     "red": "\033[0;31m", "bold": "\033[1m", "dim": "\033[2m", "nc": "\033[0m"}
TS_RE = re.compile(r"^\[(.+?)\] (.+)")
CTX_RE = re.compile(r"Context at (\d+)%")


def parse_log():
    """Parse relay log into structured events."""
    if not LOG_FILE.exists():
        return []
    events = []
    for line in LOG_FILE.read_text(errors="replace").splitlines():
        m = TS_RE.match(line)
        if not m:
            continue
        raw_ts, msg = m.group(1), m.group(2)
        try:
            ts = datetime.strptime(raw_ts, "%a %b %d %H:%M:%S %Z %Y")
        except ValueError:
            continue
        events.append({"ts": ts, "msg": msg})
    return events


def compute_stats(events):
    """Compute session statistics from parsed events."""
    sessions, errors = [], Counter()
    current_start = None
    max_ctx = 0.0

    for ev in events:
        msg = ev["msg"]
        if "Starting relay run" in msg:
            if current_start:
                sessions.append({"start": current_start, "end": ev["ts"], "ctx": max_ctx})
            current_start = ev["ts"]
            max_ctx = 0.0
        elif (m := CTX_RE.search(msg)):
            max_ctx = max(max_ctx, float(m.group(1)))
        elif "Crashed" in msg:
            errors["crashes"] += 1
        elif "rate limit" in msg.lower():
            errors["rate_limits"] += 1
        elif "Hung" in msg:
            errors["hangs"] += 1
        elif "Relay run complete" in msg and current_start:
            sessions.append({"start": current_start, "end": ev["ts"], "ctx": max_ctx})
            current_start = None
            max_ctx = 0.0

    if current_start:
        sessions.append({"start": current_start, "end": datetime.now(), "ctx": max_ctx,
                         "active": True})
    return sessions, errors


def fmt_duration(td):
    """Format timedelta as human-readable string."""
    total_s = int(td.total_seconds())
    if total_s < 60:
        return f"{total_s}s"
    h, m = divmod(total_s // 60, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def print_stats():
    """Print formatted session statistics."""
    events = parse_log()
    if not events:
        print("No relay log found. Start the relay with: relaygent start")
        return

    sessions, errors = compute_stats(events)
    today = datetime.now().date()
    today_sessions = [s for s in sessions if s["start"].date() == today]

    print(f"\n{C['cyan']}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C['nc']}")
    print(f"{C['cyan']}  Relaygent Session Stats{C['nc']}")
    print(f"{C['cyan']}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C['nc']}")

    # Today
    print(f"\n{C['bold']}Today ({today.strftime('%b %d')}){C['nc']}")
    if today_sessions:
        total_time = sum((s["end"] - s["start"] for s in today_sessions), timedelta())
        ctx_vals = [s["ctx"] for s in today_sessions if s["ctx"] > 0]
        print(f"  Sessions: {len(today_sessions)}")
        print(f"  Run time: {fmt_duration(total_time)}")
        if ctx_vals:
            print(f"  Avg context: {sum(ctx_vals)/len(ctx_vals):.0f}%")
        print(f"\n  {C['dim']}Timeline:{C['nc']}")
        for i, s in enumerate(today_sessions, 1):
            start = s["start"].strftime("%H:%M")
            dur = fmt_duration(s["end"] - s["start"])
            ctx_str = f" ctx:{s['ctx']:.0f}%" if s["ctx"] > 0 else ""
            tag = f" {C['green']}(active){C['nc']}" if s.get("active") else ""
            print(f"  {C['dim']}#{i}{C['nc']} {start}  {dur}{ctx_str}{tag}")
    else:
        print(f"  {C['dim']}No sessions today{C['nc']}")

    # All time
    if sessions:
        print(f"\n{C['bold']}All time ({len(sessions)} sessions){C['nc']}")
        total_time = sum((s["end"] - s["start"] for s in sessions), timedelta())
        ctx_vals = [s["ctx"] for s in sessions if s["ctx"] > 0]
        first = sessions[0]["start"].strftime("%b %d")
        print(f"  Since: {first}")
        print(f"  Total run time: {fmt_duration(total_time)}")
        if ctx_vals:
            print(f"  Avg context: {sum(ctx_vals)/len(ctx_vals):.0f}%")
        if any(errors.values()):
            parts = []
            for k in ("crashes", "rate_limits", "hangs"):
                if errors[k]:
                    parts.append(f"{errors[k]} {k.replace('_', ' ')}")
            print(f"  Errors: {', '.join(parts)}")
        else:
            print(f"  Errors: {C['green']}none{C['nc']}")

    # Current status
    print(f"\n{C['bold']}Current{C['nc']}")
    status = "unknown"
    if STATUS_FILE.exists():
        try:
            d = json.loads(STATUS_FILE.read_text())
            status = d.get("status", "unknown")
        except (json.JSONDecodeError, OSError):
            pass

    color = C["green"] if status == "working" else C["yellow"] if status == "sleeping" else C["nc"]
    print(f"  Status: {color}{status}{C['nc']}")

    if PCT_FILE.exists():
        try:
            pct = int(PCT_FILE.read_text().strip())
            pcolor = C["red"] if pct >= 85 else C["yellow"] if pct >= 50 else C["nc"]
            print(f"  Context: {pcolor}{pct}%{C['nc']}")
        except (ValueError, OSError):
            pass

    active = [s for s in sessions if s.get("active")]
    if active:
        dur = datetime.now() - active[0]["start"]
        print(f"  Session uptime: {fmt_duration(dur)}")
    print()


if __name__ == "__main__":
    print_stats()

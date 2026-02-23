#!/usr/bin/env python3
"""Display session statistics via the hub API."""

import json
import os
import sys
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SCRIPT_DIR.parent
DATA_DIR = Path(os.environ.get("RELAYGENT_DATA_DIR", str(REPO_DIR / "data")))
STATUS_FILE = DATA_DIR / "relay-status.json"
PCT_FILE = Path("/tmp/relaygent-context-pct")

C = {"cyan": "\033[0;36m", "green": "\033[0;32m", "yellow": "\033[1;33m",
     "red": "\033[0;31m", "bold": "\033[1m", "dim": "\033[2m", "nc": "\033[0m"}


def _hub_port():
    cfg = Path(os.environ.get("RELAYGENT_CONFIG", str(REPO_DIR / "config.json")))
    try:
        return json.loads(cfg.read_text())["hub"]["port"]
    except Exception:
        return 8080


def _fetch_stats():
    port = _hub_port()
    url = f"http://127.0.0.1:{port}/api/sessions/stats"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read())
    except Exception:
        return None


def fmt_dur(minutes):
    if not minutes or minutes < 1:
        return "<1m"
    h, m = divmod(int(minutes), 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def fmt_tokens(n):
    if not n:
        return "0"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.0f}K"
    return str(n)


def print_stats():
    data = _fetch_stats()
    if not data or data.get("total", 0) == 0:
        print("No session data found.")
        print(f"  {C['dim']}Ensure the hub is running: relaygent start{C['nc']}")
        return

    nc, bold, dim, cyan = C["nc"], C["bold"], C["dim"], C["cyan"]

    print(f"\n{cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{nc}")
    print(f"{cyan}  Relaygent Session Stats{nc}")
    print(f"{cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{nc}")

    # Today
    today = data.get("today", {})
    print(f"\n{bold}Today{nc}")
    if today.get("count"):
        print(f"  Sessions: {today['count']}")
        print(f"  Run time: {fmt_dur(today.get('durationMin'))}")
        print(f"  Tokens: {fmt_tokens(today.get('tokens'))}")
        sessions = today.get("sessions", [])
        if sessions:
            print(f"\n  {dim}Timeline:{nc}")
            for i, s in enumerate(sessions, 1):
                time_str = s.get("time", "?")[-8:-3] if s.get("time") else "?"
                dur = fmt_dur(s.get("durationMin"))
                tok = fmt_tokens(s.get("tokens"))
                goal = f"  {dim}{s['summary'][:60]}{nc}" if s.get("summary") else ""
                print(f"  {dim}#{i}{nc} {time_str}  {dur}  {tok}{goal}")
    else:
        print(f"  {dim}No sessions today{nc}")

    # All time
    at = data.get("allTime", {})
    total = data.get("total", 0)
    print(f"\n{bold}All time ({total} sessions){nc}")
    if at.get("firstSession"):
        print(f"  Since: {at['firstSession'][:10]}")
    print(f"  Tokens: {fmt_tokens(at.get('tokens'))}")
    if at.get("avgDurationMin"):
        print(f"  Avg session: {fmt_dur(at['avgDurationMin'])}")

    # Current status
    print(f"\n{bold}Current{nc}")
    status = "unknown"
    if STATUS_FILE.exists():
        try:
            d = json.loads(STATUS_FILE.read_text())
            status = d.get("status", "unknown")
            goal = d.get("goal")
        except Exception:
            goal = None
        color = C["green"] if status == "working" else C["yellow"] if status == "sleeping" else nc
        print(f"  Status: {color}{status}{nc}")
        if goal:
            print(f"  Goal: {goal[:80]}")

    if PCT_FILE.exists():
        try:
            pct = int(PCT_FILE.read_text().strip())
            pc = C["red"] if pct >= 85 else C["yellow"] if pct >= 50 else nc
            print(f"  Context: {pc}{pct}%{nc}")
        except (ValueError, OSError):
            pass
    print()


if __name__ == "__main__":
    print_stats()

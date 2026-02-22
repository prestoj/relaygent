#!/usr/bin/env python3
"""Display session statistics from the session-stats cache."""

import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SCRIPT_DIR.parent
DATA_DIR = Path(
    __import__("os").environ.get("RELAYGENT_DATA_DIR", str(REPO_DIR / "data"))
)
CACHE_FILE = DATA_DIR / "session-stats-cache.json"
STATUS_FILE = DATA_DIR / "relay-status.json"
PCT_FILE = Path("/tmp/relaygent-context-pct")

C = {"cyan": "\033[0;36m", "green": "\033[0;32m", "yellow": "\033[1;33m",
     "red": "\033[0;31m", "bold": "\033[1m", "dim": "\033[2m", "nc": "\033[0m"}


def load_sessions():
    """Load sessions from the stats cache (shared with hub)."""
    if not CACHE_FILE.exists():
        return []
    try:
        raw = json.loads(CACHE_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return []
    sessions = []
    for _path, entry in raw.items():
        s = entry.get("stats")
        if not s or not s.get("start"):
            continue
        try:
            start = datetime.fromisoformat(s["start"].replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        dur_min = s.get("durationMin", 0)
        sessions.append({
            "start": start,
            "dur_min": dur_min,
            "tokens": s.get("totalTokens", 0),
            "output": s.get("outputTokens", 0),
            "tools_total": s.get("toolCalls", 0),
            "tools": s.get("tools", {}),
            "turns": s.get("turns", 0),
            "goal": s.get("handoffGoal"),
        })
    sessions.sort(key=lambda x: x["start"])
    return sessions


def fmt_dur(minutes):
    if minutes < 1:
        return "<1m"
    h, m = divmod(minutes, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def fmt_tokens(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.0f}K"
    return str(n)


def print_stats():
    sessions = load_sessions()
    if not sessions:
        print("No session data found. Start the relay with: relaygent start")
        return

    now = datetime.now(timezone.utc)
    today = now.date()
    today_sessions = [s for s in sessions if s["start"].date() == today]

    print(f"\n{C['cyan']}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C['nc']}")
    print(f"{C['cyan']}  Relaygent Session Stats{C['nc']}")
    print(f"{C['cyan']}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{C['nc']}")

    # Today
    print(f"\n{C['bold']}Today ({today.strftime('%b %d')}){C['nc']}")
    if today_sessions:
        total_min = sum(s["dur_min"] for s in today_sessions)
        total_tok = sum(s["tokens"] for s in today_sessions)
        print(f"  Sessions: {len(today_sessions)}")
        print(f"  Run time: {fmt_dur(total_min)}")
        print(f"  Tokens: {fmt_tokens(total_tok)}")
        print(f"\n  {C['dim']}Timeline:{C['nc']}")
        for i, s in enumerate(today_sessions, 1):
            start = s["start"].strftime("%H:%M")
            dur = fmt_dur(s["dur_min"])
            goal = f"  {C['dim']}{s['goal'][:60]}{C['nc']}" if s.get("goal") else ""
            print(f"  {C['dim']}#{i}{C['nc']} {start}  {dur}  {fmt_tokens(s['tokens'])}{goal}")
    else:
        print(f"  {C['dim']}No sessions today{C['nc']}")

    # All time
    total_min = sum(s["dur_min"] for s in sessions)
    total_tok = sum(s["tokens"] for s in sessions)
    total_out = sum(s["output"] for s in sessions)
    total_tools = sum(s["tools_total"] for s in sessions)
    first = sessions[0]["start"].strftime("%b %d")

    print(f"\n{C['bold']}All time ({len(sessions)} sessions){C['nc']}")
    print(f"  Since: {first}")
    print(f"  Total run time: {fmt_dur(total_min)}")
    print(f"  Tokens: {fmt_tokens(total_tok)} in, {fmt_tokens(total_out)} out")
    print(f"  Tool calls: {total_tools:,}")

    # Top tools
    all_tools = Counter()
    for s in sessions:
        for name, count in s["tools"].items():
            all_tools[name] += count
    if all_tools:
        top = all_tools.most_common(8)
        parts = [f"{n}({c})" for n, c in top]
        print(f"  Top tools: {', '.join(parts)}")

    # Avg session
    durs = [s["dur_min"] for s in sessions if s["dur_min"] > 0]
    if durs:
        avg = sum(durs) / len(durs)
        print(f"  Avg session: {fmt_dur(int(avg))}")

    # Current status
    print(f"\n{C['bold']}Current{C['nc']}")
    status = "unknown"
    goal = None
    if STATUS_FILE.exists():
        try:
            d = json.loads(STATUS_FILE.read_text())
            status = d.get("status", "unknown")
            goal = d.get("goal")
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

    if goal:
        print(f"  Goal: {goal[:80]}")
    print()


if __name__ == "__main__":
    print_stats()

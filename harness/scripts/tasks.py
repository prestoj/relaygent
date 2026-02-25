#!/usr/bin/env python3
"""relaygent tasks — view and manage recurring tasks from tasks.md."""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timedelta

CYAN = "\033[0;36m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
DIM = "\033[2m"
NC = "\033[0m"

TASK_RE = re.compile(
    r"^- \[[ x]\] (.+?)\s*\|\s*type:\s*(\w[\w-]*)"
    r"\s*\|\s*freq:\s*(\w+)"
    r"\s*\|\s*last:\s*(.+)$"
)
ONEOFF_RE = re.compile(r"^- \[ \] (.+?)\s*\|\s*type:\s*one-off\s*$")
FREQ_MAP = {
    "6h": timedelta(hours=6), "12h": timedelta(hours=12),
    "daily": timedelta(days=1), "2d": timedelta(days=2),
    "3d": timedelta(days=3), "weekly": timedelta(weeks=1),
    "monthly": timedelta(days=30),
}


def parse_tasks(path: str) -> list[dict]:
    tasks = []
    with open(path, errors="replace") as f:
        for i, line in enumerate(f):
            stripped = line.strip()
            m = TASK_RE.match(stripped)
            if not m:
                m_one = ONEOFF_RE.match(stripped)
                if m_one:
                    tasks.append({"desc": m_one.group(1), "type": "one-off",
                                  "freq": "-", "last": None, "due": datetime.min, "line": i})
                continue
            desc, ttype, freq, last_str = m.groups()
            last_str = last_str.strip()
            try:
                last = datetime.strptime(last_str, "%Y-%m-%d %H:%M")
            except ValueError:
                try:
                    last = datetime.strptime(last_str, "%Y-%m-%d")
                except ValueError:
                    last = None
            delta = FREQ_MAP.get(freq)
            due = (last + delta) if (last and delta) else None
            tasks.append({"desc": desc, "type": ttype, "freq": freq,
                          "last": last, "due": due, "line": i})
    return tasks


def show_tasks(tasks: list[dict], only_due: bool = False):
    now = datetime.now()
    shown = 0
    for t in sorted(tasks, key=lambda x: x["due"] or datetime.min):
        is_oneoff = t["type"] == "one-off"
        overdue = (not is_oneoff) and t["due"] and t["due"] <= now
        if only_due and not overdue and not is_oneoff:
            continue
        shown += 1
        if is_oneoff:
            status = f"{YELLOW}TODO{NC}"
        elif overdue:
            status = f"{RED}OVERDUE{NC}"
        else:
            status = f"{GREEN}ok{NC}"
        last_str = t["last"].strftime("%m-%d %H:%M") if t["last"] else "never"
        due_str = t["due"].strftime("%m-%d %H:%M") if (t["due"] and not is_oneoff) else "-"
        print(f"  [{status}] {t['desc']}")
        print(f"       {DIM}freq: {t['freq']}  last: {last_str}  due: {due_str}{NC}")
    if shown == 0:
        print(f"  {GREEN}Nothing due!{NC}" if only_due else "  No tasks found.")
    else:
        overdue_count = sum(1 for t in tasks if t["due"] and t["due"] <= now)
        if overdue_count and not only_due:
            print(f"\n  {YELLOW}{overdue_count} overdue task(s){NC}")


def mark_done(path: str, tasks: list[dict], pattern: str):
    pattern_lower = pattern.lower()
    matches = [t for t in tasks if pattern_lower in t["desc"].lower()]
    if not matches:
        print(f"  {RED}No task matching '{pattern}'{NC}")
        sys.exit(1)
    if len(matches) > 1:
        print(f"  {YELLOW}Multiple matches for '{pattern}':{NC}")
        for t in matches:
            print(f"    - {t['desc']}")
        print(f"  Be more specific.")
        sys.exit(1)
    task = matches[0]
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(path) as f:
        lines = f.readlines()
    old_line = lines[task["line"]]
    new_line = re.sub(r"last:\s*.+$", f"last: {now_str}", old_line)
    lines[task["line"]] = new_line
    with open(path, "w") as f:
        f.writelines(lines)
    print(f"  {GREEN}Done:{NC} {task['desc']}")
    print(f"  {DIM}Updated last → {now_str}{NC}")


def main():
    # Find tasks.md via config or fallback
    kb_dir = os.environ.get("RELAYGENT_KB_DIR", "")
    if not kb_dir:
        config_path = os.path.join(os.environ["HOME"], ".relaygent", "config.json")
        if os.path.isfile(config_path):
            import json
            with open(config_path) as f:
                cfg = json.load(f)
            kb_dir = cfg.get("paths", {}).get("kb", "")
    tasks_path = os.path.join(kb_dir, "tasks.md") if kb_dir else ""
    if not tasks_path or not os.path.isfile(tasks_path):
        print(f"  {RED}tasks.md not found{NC} — set RELAYGENT_KB_DIR or run setup")
        sys.exit(1)

    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    tasks = parse_tasks(tasks_path)

    if cmd in ("list", "ls"):
        print(f"{CYAN}Tasks{NC} — {tasks_path}\n")
        show_tasks(tasks)
    elif cmd == "due":
        print(f"{CYAN}Overdue Tasks{NC}\n")
        show_tasks(tasks, only_due=True)
    elif cmd == "done":
        if len(sys.argv) < 3:
            print(f"  Usage: relaygent tasks done <pattern>")
            sys.exit(1)
        mark_done(tasks_path, tasks, " ".join(sys.argv[2:]))
    else:
        print(f"  Usage: relaygent tasks [list|due|done <pattern>]")
        sys.exit(1)


if __name__ == "__main__":
    main()

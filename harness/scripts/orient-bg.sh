#!/bin/bash
# Orient background tasks — show status of registered long-running processes
# Sourced by orient.sh (expects DATA_DIR from parent)

BG_FILE="$DATA_DIR/background-tasks.json"
[ ! -f "$BG_FILE" ] && return 0

python3 - "$BG_FILE" <<'PYEOF' 2>/dev/null
import json, sys, os, time
from datetime import datetime

bg_file = sys.argv[1]
try:
    tasks = json.load(open(bg_file))
except (json.JSONDecodeError, FileNotFoundError):
    sys.exit(0)

if not tasks:
    sys.exit(0)

running, dead = [], []
for t in tasks:
    pid = t.get("pid", 0)
    alive = False
    try:
        os.kill(pid, 0)
        alive = True
    except (OSError, TypeError):
        pass
    if alive:
        running.append(t)
    else:
        dead.append(t)

# Auto-clean dead tasks from registry
if dead:
    with open(bg_file, "w") as f:
        json.dump(running, f)

if running:
    print(f"\n\033[0;34mBackground:\033[0m {len(running)} task(s)")
    for t in running:
        started = t.get("started", "")
        desc = t.get("desc", "unknown")
        pid = t.get("pid", "?")
        # Duration
        dur = ""
        if started:
            try:
                st = datetime.fromisoformat(started)
                secs = int(time.time() - st.timestamp())
                if secs >= 3600:
                    dur = f" ({secs // 3600}h{(secs % 3600) // 60}m)"
                elif secs >= 60:
                    dur = f" ({secs // 60}m)"
                else:
                    dur = f" ({secs}s)"
            except (ValueError, TypeError):
                pass
        print(f"  \033[0;32m●\033[0m {desc} (pid {pid}){dur}")

if dead:
    print(f"  \033[0;33m○\033[0m {len(dead)} task(s) finished (cleaned)")
PYEOF

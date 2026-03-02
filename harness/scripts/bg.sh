#!/bin/bash
# Manage background task registry — track long-running processes across sessions
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config

BG_FILE="$DATA_DIR/background-tasks.json"
[ ! -f "$BG_FILE" ] && echo '[]' > "$BG_FILE"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

show_help() {
    echo -e "${CYAN}Usage:${NC} relaygent bg <command>\n"
    printf "  %-22s %s\n" \
        "list" "Show registered tasks with status (default)" \
        "add <pid> <desc>" "Register a background task" \
        "  --log <path>" "  Log file to tail for status" \
        "  --log-pattern <re>" "  Regex to filter log lines (e.g. 'step')" \
        "log <pid> <path> [re]" "Set/update log file for a task" \
        "rm <pid>" "Unregister a task" \
        "clean" "Remove dead (finished) tasks"
}

do_list() {
    python3 - "$BG_FILE" <<'PYEOF'
import json, sys, os, time, re
from datetime import datetime

tasks = json.load(open(sys.argv[1]))
if not tasks:
    print("No background tasks registered."); sys.exit(0)

for t in tasks:
    pid, desc = t.get("pid", 0), t.get("desc", "?")
    started, cmd = t.get("started", ""), t.get("cmd", "")
    log_file, log_pat = t.get("log", ""), t.get("log_pattern", "")
    alive = False
    try: os.kill(pid, 0); alive = True
    except (OSError, TypeError): pass

    dur = ""
    if started:
        try:
            secs = int(time.time() - datetime.fromisoformat(started).timestamp())
            if secs >= 3600: dur = f"{secs//3600}h{(secs%3600)//60}m"
            elif secs >= 60: dur = f"{secs//60}m"
            else: dur = f"{secs}s"
        except (ValueError, TypeError): pass

    status = f"\033[0;32m● running\033[0m" if alive else f"\033[0;31m○ stopped\033[0m"
    print(f"  {status}  pid={pid}  {dur:>6s}  {desc}")
    if cmd: print(f"         cmd: {cmd[:70]}")
    # Show last matching log line
    if log_file and os.path.exists(log_file):
        try:
            with open(log_file, "rb") as f:
                f.seek(0, 2); end = f.tell()
                pos = max(0, end - 8192); f.seek(pos)
                lines = f.read().decode("utf-8", errors="replace").splitlines()
            if log_pat:
                lines = [l for l in lines if re.search(log_pat, l)]
            if lines:
                print(f"         log: {lines[-1].strip()[:80]}")
        except Exception:
            pass
PYEOF
}

do_add() {
    local pid="" desc="" log_file="" log_pattern=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --log) log_file="$2"; shift 2 ;;
            --log-pattern) log_pattern="$2"; shift 2 ;;
            *) if [ -z "$pid" ]; then pid="$1"; else desc="${desc:+$desc }$1"; fi; shift ;;
        esac
    done
    if [ -z "$pid" ] || [ -z "$desc" ]; then
        echo -e "${RED}Usage: relaygent bg add <pid> <desc> [--log <path>] [--log-pattern <re>]${NC}"; exit 1
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        echo -e "${YELLOW}Warning: PID $pid is not running${NC}"
    fi
    local cmd
    cmd=$(ps -p "$pid" -o args= 2>/dev/null | head -c 120 || echo "")
    python3 - "$BG_FILE" "$pid" "$desc" "$cmd" "$log_file" "$log_pattern" <<'PYEOF'
import json, sys, os
from datetime import datetime
bg_file, pid, desc, cmd = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
log_file, log_pattern = sys.argv[5], sys.argv[6]
tasks = json.load(open(bg_file))
started = datetime.now()
try:
    stat_path = f"/proc/{pid}/stat"
    if os.path.exists(stat_path):
        with open("/proc/uptime") as f:
            uptime = float(f.read().split()[0])
        with open(stat_path) as f:
            fields = f.read().rsplit(")", 1)[1].split()
            start_ticks = int(fields[19])
            hz = os.sysconf("SC_CLK_TCK")
            boot = datetime.now().timestamp() - uptime
            started = datetime.fromtimestamp(boot + start_ticks / hz)
except Exception:
    pass
tasks = [t for t in tasks if t.get("pid") != pid]
entry = {"pid": pid, "desc": desc, "started": started.isoformat(timespec="seconds"), "cmd": cmd}
if log_file: entry["log"] = log_file
if log_pattern: entry["log_pattern"] = log_pattern
tasks.append(entry)
with open(bg_file, "w") as f: json.dump(tasks, f, indent=2)
print(f"Registered: pid={pid} — {desc}")
PYEOF
}

do_log() {
    local pid="${1:-}" log_file="${2:-}" log_pattern="${3:-}"
    if [ -z "$pid" ] || [ -z "$log_file" ]; then
        echo -e "${RED}Usage: relaygent bg log <pid> <log-path> [pattern]${NC}"; exit 1
    fi
    python3 - "$BG_FILE" "$pid" "$log_file" "$log_pattern" <<'PYEOF'
import json, sys
bg_file, pid = sys.argv[1], int(sys.argv[2])
log_file, log_pattern = sys.argv[3], sys.argv[4]
tasks = json.load(open(bg_file))
found = False
for t in tasks:
    if t.get("pid") == pid:
        t["log"] = log_file
        if log_pattern: t["log_pattern"] = log_pattern
        found = True; break
with open(bg_file, "w") as f: json.dump(tasks, f, indent=2)
if found: print(f"Log set for pid={pid}: {log_file}")
else: print(f"No task with pid={pid}")
PYEOF
}

do_rm() {
    local pid="${1:-}"
    if [ -z "$pid" ]; then
        echo -e "${RED}Usage: relaygent bg rm <pid>${NC}"; exit 1
    fi
    python3 - "$BG_FILE" "$pid" <<'PYEOF'
import json, sys
bg_file, pid = sys.argv[1], int(sys.argv[2])
tasks = json.load(open(bg_file))
before = len(tasks)
tasks = [t for t in tasks if t.get("pid") != pid]
with open(bg_file, "w") as f: json.dump(tasks, f, indent=2)
if len(tasks) < before: print(f"Removed pid={pid}")
else: print(f"No task with pid={pid}")
PYEOF
}

do_clean() {
    python3 - "$BG_FILE" <<'PYEOF'
import json, sys, os
bg_file = sys.argv[1]
tasks = json.load(open(bg_file))
alive = []
for t in tasks:
    try: os.kill(t.get("pid", 0), 0); alive.append(t)
    except (OSError, TypeError): pass
removed = len(tasks) - len(alive)
with open(bg_file, "w") as f: json.dump(alive, f, indent=2)
print(f"Cleaned {removed} dead task(s), {len(alive)} still running.")
PYEOF
}

case "${1:-list}" in
    list)  do_list ;;
    add)   shift; do_add "$@" ;;
    log)   do_log "${2:-}" "${3:-}" "${4:-}" ;;
    rm)    do_rm "${2:-}" ;;
    clean) do_clean ;;
    help|--help|-h) show_help ;;
    *)     echo -e "${RED}Unknown: $1${NC}"; show_help; exit 1 ;;
esac

#!/usr/bin/env bash
# Shared helpers for relaygent CLI scripts.
# Source this file — do not execute directly.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$LIB_DIR/../.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
PID_DIR="$HOME/.relaygent"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}Not set up yet. Run: ./setup.sh${NC}"; exit 1
    fi
    local config_vars
    config_vars="$(python3 -c "
import json,shlex,sys
try:
 c=json.load(open('$CONFIG_FILE'));s=c['services']
 for k,v in[('HUB_PORT',c['hub']['port']),
  ('NOTIF_PORT',s['notifications']['port']),('HS_PORT',s.get('hammerspoon',{}).get('port',8097)),
  ('DATA_DIR',c['paths']['data']),('KB_DIR',c['paths']['kb'])]:print(f'{k}={shlex.quote(str(v))}')
except Exception: sys.exit(1)
")" || { echo -e "${RED}Failed to parse $CONFIG_FILE. Re-run ./setup.sh${NC}"; exit 1; }
    eval "$config_vars"
    export RELAYGENT_DATA_DIR="$DATA_DIR" RELAYGENT_KB_DIR="$KB_DIR" RELAYGENT_HUB_PORT="$HUB_PORT"
    export HAMMERSPOON_PORT="$HS_PORT" RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT"
}

port_pids() {
    if command -v lsof &>/dev/null; then lsof -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -3
    elif command -v ss &>/dev/null; then ss -tlnp "sport = :$1" 2>/dev/null | awk 'NR>1{match($0,/pid=([0-9]+)/,a); if(a[1]) print a[1]}' | head -3; fi
}

check_port() {
    local pids; pids=$(port_pids "$1")
    if [ -n "$pids" ]; then
        local cmd; cmd=$(ps -p "$(echo "$pids" | head -1)" -o args= 2>/dev/null | head -c 80)
        echo -e "  ${RED}Port $1 ($2) in use by: ${cmd:-unknown}${NC}"
        echo -e "    Kill: ${YELLOW}kill $pids${NC}"
        return 1
    fi
}

# Kill stale relaygent processes on a port. Returns 0 if port is now free.
clear_stale_port() {
    local port=$1 name=$2 pids cmd
    pids=$(port_pids "$port"); [ -z "$pids" ] && return 0
    cmd=$(ps -p "$(echo "$pids" | head -1)" -o args= 2>/dev/null || echo "")
    if echo "$cmd" | grep -q "relaygent"; then
        echo -e "  ${YELLOW}Clearing stale $name (pid $pids)${NC}"
        kill -TERM $pids 2>/dev/null || true
        local i; for i in 1 2 3; do sleep 0.5; pids=$(port_pids "$port"); [ -z "$pids" ] && return 0; done
        kill -9 $pids 2>/dev/null || true; sleep 0.3
        pids=$(port_pids "$port"); [ -z "$pids" ] && return 0
        echo -e "  ${RED}Could not clear stale $name on port $port${NC}"; return 1
    fi
    echo -e "  ${RED}Port $port ($name) in use by non-relaygent process: ${cmd:-unknown}${NC}"
    echo -e "    Kill manually: ${YELLOW}kill $pids${NC}"; return 1
}

ensure_venv() {
    local dir=$1
    if [ ! -d "$dir/.venv" ] || [ ! -f "$dir/.venv/bin/python3" ]; then
        rm -rf "$dir/.venv" 2>/dev/null
        if ! python3 -m venv "$dir/.venv" 2>/dev/null; then
            echo -e "  ${RED}Failed to create venv in $dir${NC}"; return 1
        fi
        if ! "$dir/.venv/bin/pip" install -q -r "$dir/requirements.txt" 2>&1 | tail -1; then
            echo -e "  ${RED}Failed to install deps in $dir${NC}"; return 1
        fi
    fi
}

is_platform_managed() {
    local svc=$1
    if [ "$(uname)" = "Darwin" ]; then
        launchctl list "com.relaygent.${svc}" &>/dev/null && return 0
    else
        systemctl --user is-enabled "relaygent-${svc}.service" &>/dev/null && return 0
    fi
    return 1
}

platform_start() {
    local name=$1 svc=$2
    if [ "$(uname)" = "Darwin" ]; then
        local plist="$HOME/Library/LaunchAgents/com.relaygent.${svc}.plist"
        launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
        launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null
        echo -e "  $name: ${GREEN}managed by LaunchAgent${NC}"
    else
        systemctl --user start "relaygent-${svc}.service" 2>/dev/null
        echo -e "  $name: ${GREEN}managed by systemd${NC}"
    fi
}

start_service() {
    local name=$1 pidfile="$PID_DIR/$2.pid" logfile="$REPO_DIR/logs/relaygent-$2.log"
    shift 2
    mkdir -p "$REPO_DIR/logs"
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
        echo -e "  $name: ${GREEN}already running${NC}"
        return
    fi
    "$@" > "$logfile" 2>&1 &
    echo $! > "$pidfile"
    echo -e "  $name: ${GREEN}started${NC}"
}

stop_process() {
    local name=$1 pidfile="$PID_DIR/$2.pid"
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
        local pid; pid=$(cat "$pidfile")
        pkill -TERM -P "$pid" 2>/dev/null || true; kill -TERM "$pid" 2>/dev/null || true
        for _ in 1 2 3; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
        echo -e "  $name: ${YELLOW}stopped${NC}"
    else
        echo -e "  $name: ${YELLOW}not running${NC}"
    fi
    rm -f "$pidfile" 2>/dev/null
}

check_process() {
    local n=$1 svc=$2 p="$PID_DIR/$2.pid" port=${3:-}
    if [[ -f "$p" ]] && kill -0 "$(cat "$p")" 2>/dev/null; then
        echo -e "  $n: ${GREEN}running${NC} (pid $(cat "$p"))"
    elif [[ -n "$port" ]] && port_pids "$port" &>/dev/null; then
        echo -e "  $n: ${GREEN}running${NC} (port $port)"
    elif [ "$(uname)" = "Darwin" ]; then
        local la; la=$(launchctl list 2>/dev/null | grep "	com\.relaygent\.${svc}$" || true)
        if [ -n "$la" ] && [ "$(echo "$la" | awk '{print $1}')" != "-" ]; then
            echo -e "  $n: ${GREEN}running${NC} (LaunchAgent)"
        elif [ -n "$la" ]; then
            echo -e "  $n: ${YELLOW}loaded but crashed${NC}"
        else
            echo -e "  $n: ${RED}stopped${NC}"
        fi
    elif systemctl --user is-active --quiet "relaygent-${svc}.service" 2>/dev/null; then
        echo -e "  $n: ${GREEN}running${NC} (systemd)"
    else
        echo -e "  $n: ${RED}stopped${NC}"
    fi
}

verify_service() {
    local name=$1 url=$2 retries=${3:-5}
    for i in $(seq 1 "$retries"); do
        sleep 1
        if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    done
    echo -e "    ${YELLOW}Warning: $name started but not responding after ${retries}s${NC}"
    return 1
}

# --- Check helpers (for check.sh and similar diagnostic scripts) ---
_CK_PASS=0; _CK_FAIL=0; _CK_WARN=0
ck_ok()   { echo -e "  ✓ $1: ${GREEN}$2${NC}";   _CK_PASS=$((_CK_PASS+1)); }
ck_warn() { echo -e "  ⚠ $1: ${YELLOW}$2${NC}"; _CK_WARN=$((_CK_WARN+1)); }
ck_fail() { echo -e "  ✗ $1: ${RED}$2${NC}";    _CK_FAIL=$((_CK_FAIL+1)); }

ck_summary() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ "$_CK_FAIL" -gt 0 ]; then
        echo -e "  ${RED}$_CK_FAIL failed, $_CK_WARN warnings, $_CK_PASS passed.${NC}"
        echo -e "  ${RED}Fix failures above before running: relaygent start${NC}"
        return 1
    elif [ "$_CK_WARN" -gt 0 ]; then
        echo -e "  ${YELLOW}$_CK_WARN warnings, $_CK_PASS passed. System usable but review warnings.${NC}"
    else
        echo -e "  ${GREEN}All $_CK_PASS checks passed.${NC}"
    fi
}

load_config_soft() {
    HUB_PORT=8080; NOTIF_PORT=8083; HS_PORT=8097; KB_DIR=""; DATA_DIR="$REPO_DIR/data"
    [ ! -f "$CONFIG_FILE" ] && return 1
    local cv
    cv="$(python3 -c "
import json,shlex,sys
try:
 c=json.load(open('$CONFIG_FILE'));s=c['services']
 for k,v in[('HUB_PORT',c['hub']['port']),('DATA_DIR',c['paths']['data']),
  ('NOTIF_PORT',s['notifications']['port']),('HS_PORT',s.get('hammerspoon',{}).get('port',8097)),
  ('KB_DIR',c['paths']['kb'])]:print(f'{k}={shlex.quote(str(v))}')
except Exception: sys.exit(1)
")" || return 1
    eval "$cv"
}

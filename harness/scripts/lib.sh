#!/usr/bin/env bash
# Shared helpers for relaygent CLI scripts.
# Source this file — do not execute directly.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$LIB_DIR/../.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
PID_DIR="$HOME/.relaygent"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

is_docker() { [[ -f /.dockerenv ]] || grep -q '"docker".*true' "$CONFIG_FILE" 2>/dev/null; }

load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}Not set up yet. Run: ./setup.sh${NC}"; exit 1
    fi
    local config_vars
    config_vars="$(python3 -c "
import json,shlex,sys
try:
 c=json.load(open('$CONFIG_FILE'));s=c['services']
 tls='https' if c.get('hub',{}).get('tls',{}).get('cert') else 'http'
 tls_host=c.get('hub',{}).get('tls',{}).get('hostname','')
 for k,v in[('HUB_PORT',c['hub']['port']),
  ('NOTIF_PORT',s['notifications']['port']),('HS_PORT',s.get('hammerspoon',{}).get('port',8097)),
  ('DATA_DIR',c['paths']['data']),('KB_DIR',c['paths']['kb']),('HUB_SCHEME',tls),('TLS_HOSTNAME',tls_host)]:print(f'{k}={shlex.quote(str(v))}')
except Exception as e: print(f'config error: {e}',file=sys.stderr); sys.exit(1)
")" || { echo -e "${RED}Failed to parse $CONFIG_FILE — see error above. Re-run ./setup.sh${NC}"; exit 1; }
    eval "$config_vars"
    export RELAYGENT_DATA_DIR="$DATA_DIR" RELAYGENT_KB_DIR="$KB_DIR" RELAYGENT_HUB_PORT="$HUB_PORT"
    export HAMMERSPOON_PORT="$HS_PORT" RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT"
    [[ "${HUB_SCHEME:-http}" == "https" ]] && CURL_K="-k" || CURL_K=""
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
        if ! "$dir/.venv/bin/pip" install -q -r "$dir/requirements.txt" 2>/dev/null; then
            echo -e "  ${RED}Failed to install deps in $dir${NC}"; return 1
        fi
    fi
}

# Service management: is_platform_managed, platform_start, start_service, stop_process, check_process
source "$LIB_DIR/service-mgmt.sh"

verify_service() {
    local name=$1 url=$2 retries=${3:-5}
    for i in $(seq 1 "$retries"); do
        sleep 1
        if curl -sf $CURL_K --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    done
    echo -e "    ${YELLOW}Warning: $name started but not responding after ${retries}s${NC}"
    return 1
}

load_config_soft() {
    HUB_PORT=8080; NOTIF_PORT=8083; HS_PORT=8097; KB_DIR=""; DATA_DIR="$REPO_DIR/data"
    HUB_SCHEME=http; TLS_HOSTNAME=""; CURL_K=""
    [ ! -f "$CONFIG_FILE" ] && return 1
    local cv
    cv="$(python3 -c "
import json,shlex,sys
try:
 c=json.load(open('$CONFIG_FILE'));s=c['services']
 tls='https' if c.get('hub',{}).get('tls',{}).get('cert') else 'http'
 tls_host=c.get('hub',{}).get('tls',{}).get('hostname','')
 for k,v in[('HUB_PORT',c['hub']['port']),('DATA_DIR',c['paths']['data']),
  ('NOTIF_PORT',s['notifications']['port']),('HS_PORT',s.get('hammerspoon',{}).get('port',8097)),
  ('KB_DIR',c['paths']['kb']),('HUB_SCHEME',tls),('TLS_HOSTNAME',tls_host)]:print(f'{k}={shlex.quote(str(v))}')
except Exception as e: print(f'config error: {e}',file=sys.stderr); sys.exit(1)
")" || return 1
    eval "$cv"
    [[ "${HUB_SCHEME:-http}" == "https" ]] && CURL_K="-k" || CURL_K=""
}

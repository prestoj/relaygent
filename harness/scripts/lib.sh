#!/usr/bin/env bash
# Shared helpers for relaygent CLI scripts.
# Source this file — do not execute directly.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$LIB_DIR/../.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
PID_DIR="$HOME/.relaygent"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

is_docker() { [[ -f /.dockerenv ]] || grep -q '"docker".*true' "$CONFIG_FILE" 2>/dev/null; }

# Re-exec the calling script in a NEW session (its own process group) so a mid-run
# SIGKILL when the relay session sleeps/ends can't kill a long-running job. The relay
# kills its session via killpg(session_pgid); a Bash-tool child (even run_in_background)
# lives in that group, so the weekly full-update was killed mid-`brew` this way
# (2026-06-14). The original process tails the log so the agent still sees live output,
# then exits; the detached worker runs to completion and the summary lands in the log
# for any session to read. macOS ships no `setsid` binary — use python's os.setsid().
# CALLER MUST BE NON-INTERACTIVE (cron/relay/CLI — all are): os.setsid() EPERMs from a
# process that's already a group leader, i.e. under job control / an interactive shell,
# and the worker would silently no-op. To reuse from an interactive context, fork first.
# Call as the FIRST real line of a script: ensure_detached "$0" "$@"
ensure_detached() {
    [ -n "${RELAYGENT_DETACHED:-}" ] && return 0   # already inside the detached worker
    local script="$1"; shift
    local stem; stem="$(basename "$script" .sh)"
    local logdir="${RELAYGENT_DATA_DIR:-$HOME/data}/updates"
    mkdir -p "$logdir" || { echo "ensure_detached: cannot mkdir $logdir — running inline" >&2; return 0; }
    local log; log="$logdir/$stem-$(date +%Y%m%d-%H%M%S).log"
    ln -sf "$log" "$logdir/$stem-latest.log"
    RELAYGENT_DETACHED=1 nohup python3 -c \
        'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
        bash "$script" "$@" >"$log" 2>&1 &
    local worker=$!
    echo -e "${CYAN}Running detached (pid $worker — survives session-sleep). Log: $log${NC}"
    tail -n +1 -f "$log" 2>/dev/null & local tp=$!
    while kill -0 "$worker" 2>/dev/null; do sleep 2; done
    sleep 1; kill "$tp" 2>/dev/null || true
    echo -e "${CYAN}Detached run finished — full summary in: $log${NC}"
    exit 0
}

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

# Returns 0 iff PATH claude ($2) resolves OUTSIDE the live npm prefix ($1) — both canonicalized
# (/var→/private/var etc.) so a symlinked prefix component can't fake a verdict. Purely a location
# check, independent of whether the live-prefix binary exists (the trigger case has an empty new
# prefix). Shared by claude_off_prefix (the gate) and repoint_claude_symlink.
_claude_resolves_offprefix() {
    local prefix_real; prefix_real="$(readlink -f "$1" 2>/dev/null || printf '%s' "$1")"
    local target; target="$(readlink -f "$2" 2>/dev/null || true)"
    case "$target" in "$prefix_real"/*) return 1 ;; esac
    return 0
}

# Repoint the first-on-PATH `claude` symlink at the live npm-prefix binary when it has drifted —
# a stale version (#772: node bump moved the prefix) or current-but-in-an-old-keg a `brew cleanup`
# will delete (near-outage 2026-06-28). Acts only on an owned symlink in a writable dir when the
# live-prefix binary exists and equals $1 (latest; "" skips the gate); no-ops on native / system
# layouts (safe off macOS). Prints a note + returns 0 iff it repointed; 1 otherwise.
repoint_claude_symlink() {
    local latest="$1"
    local npm_prefix; npm_prefix="$(npm prefix -g 2>/dev/null || true)"
    [ -n "$npm_prefix" ] || return 1
    local path_claude; path_claude="$(command -v claude 2>/dev/null || true)"
    local installed_bin="$npm_prefix/bin/claude"
    [ -L "$path_claude" ] || return 1
    [ -w "$(dirname "$path_claude")" ] || return 1
    [ -e "$installed_bin" ] || return 1
    [ "$installed_bin" != "$path_claude" ] || return 1
    local installed_ver; installed_ver="$("$installed_bin" --version 2>/dev/null | awk '{print $1}' || true)"
    [ -n "$installed_ver" ] || return 1
    [ -z "$latest" ] || [ "$installed_ver" = "$latest" ] || return 1
    local path_ver; path_ver="$("$path_claude" --version 2>/dev/null | awk '{print $1}' || true)"
    local need=0
    if _claude_resolves_offprefix "$npm_prefix" "$path_claude"; then need=1; fi  # off the live prefix
    if [ "$path_ver" != "$installed_ver" ]; then need=1; fi                       # or a stale version
    if [ "$need" = 0 ]; then return 1; fi                                         # healthy — no-op
    ln -sf "$installed_bin" "$path_claude"
    echo -e "  Claude Code: ${YELLOW}repointed claude symlink → live keg ($path_claude → $installed_bin)${NC}"
}

# True (0) iff the first-on-PATH `claude` is an owned repointable symlink resolving OUTSIDE the live
# npm prefix. Callers gate the "already latest" fast-path on `! claude_off_prefix` so off-prefix
# drift forces a reinstall INTO the live prefix even at an unchanged version — the 06-28 hole:
# latest via the old keg, new prefix empty → nothing to repoint to unless we reinstall first.
claude_off_prefix() {
    local npm_prefix; npm_prefix="$(npm prefix -g 2>/dev/null || true)"
    [ -n "$npm_prefix" ] || return 1
    local path_claude; path_claude="$(command -v claude 2>/dev/null || true)"
    [ -L "$path_claude" ] || return 1
    [ -w "$(dirname "$path_claude")" ] || return 1
    if _claude_resolves_offprefix "$npm_prefix" "$path_claude"; then return 0; fi
    return 1
}

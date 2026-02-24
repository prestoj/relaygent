#!/usr/bin/env bash
# Service management helpers for relaygent CLI scripts.
# Sourced by lib.sh — do not source directly (needs lib.sh variables).

is_platform_managed() {
    local svc=$1
    is_docker 2>/dev/null && return 1
    if [ "$(uname)" = "Darwin" ]; then
        launchctl list "com.relaygent.${svc}" &>/dev/null && return 0
    else
        systemctl --user is-enabled "relaygent-${svc}.service" &>/dev/null && return 0
    fi
    return 1
}

platform_start() {
    local name=$1 svc=$2
    if is_docker 2>/dev/null; then echo -e "  $name: ${YELLOW}Docker — start via entrypoint${NC}"; return; fi
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
    elif is_docker 2>/dev/null; then
        echo -e "  $n: ${RED}stopped${NC} (Docker — restart container)"
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

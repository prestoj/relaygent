#!/usr/bin/env bash
# relaygent start — launch all services
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

load_config
_T0=$(date +%s)
echo -e "${CYAN}Starting Relaygent...${NC}"

# Check critical dependencies
if [ ! -d "$REPO_DIR/hub/node_modules" ]; then
    echo -e "  ${RED}Hub dependencies not installed.${NC}"
    echo -e "  Run: ${CYAN}relaygent update${NC} (installs deps and builds hub)"
    exit 1
fi

# Port checks — auto-clear stale relaygent processes, fail on foreign processes
port_ok=true
is_platform_managed hub || clear_stale_port "$HUB_PORT" "Hub" || port_ok=false
is_platform_managed notifications || clear_stale_port "$NOTIF_PORT" "Notifications" || port_ok=false
if [ "$port_ok" = false ]; then
    echo -e "\n  ${RED}Fix port conflicts above, then try again.${NC}"; exit 1
fi

# Computer-use backend (platform-specific)
if [ "$(uname)" = "Darwin" ]; then
    if ! pgrep -x Hammerspoon >/dev/null 2>&1; then
        if command -v open &>/dev/null && open -Ra Hammerspoon 2>/dev/null; then
            open -a Hammerspoon
            echo -e "  Hammerspoon: ${GREEN}launched${NC}"
        else
            echo -e "  Hammerspoon: ${YELLOW}not installed (computer-use unavailable)${NC}"
        fi
    else
        echo -e "  Hammerspoon: ${GREEN}already running${NC}"
    fi
elif [ "$(uname)" = "Linux" ]; then
    missing=""
    for dep in xdotool scrot wmctrl convert; do
        command -v "$dep" &>/dev/null || missing="$missing $dep"
    done
    python3 -c "import pyatspi" 2>/dev/null || missing="$missing python3-pyatspi"
    if [ -n "$missing" ]; then
        echo -e "  Computer-use: ${YELLOW}missing deps:${missing}${NC}"
        echo -e "    ${YELLOW}Install: sudo apt install xdotool scrot wmctrl imagemagick python3-pyatspi at-spi2-core${NC}"
    elif [ -z "${DISPLAY:-}" ]; then
        if command -v Xvfb &>/dev/null; then
            export DISPLAY=:99
            Xvfb :99 -screen 0 1024x768x24 -nolisten tcp >> "$REPO_DIR/logs/relaygent-xvfb.log" 2>&1 &
            echo $! > "$PID_DIR/xvfb.pid"
            sleep 0.5
            echo -e "  Xvfb: ${GREEN}started${NC} (DISPLAY=:99)"
        else
            echo -e "  Computer-use: ${YELLOW}no DISPLAY set and Xvfb not found${NC}"
        fi
    fi
    if [ -n "${DISPLAY:-}" ]; then
        clear_stale_port "$HS_PORT" "Computer-use" || port_ok=false
        if [ "$port_ok" = true ]; then
            start_service "Computer-use (port $HS_PORT)" "computer-use" \
                env DISPLAY="${DISPLAY:-:0}" python3 "$REPO_DIR/computer-use/linux-server.py"
            sleep 0.5
            if ! curl -sf --max-time 2 "http://localhost:$HS_PORT/health" >/dev/null 2>&1; then
                echo -e "    ${YELLOW}Warning: server started but /health not responding${NC}"
            fi
        fi
    fi
else
    echo -e "  Computer-use: ${YELLOW}unavailable (unsupported platform)${NC}"
fi

# Hub — build if needed
if [ ! -d "$REPO_DIR/hub/build" ]; then
    echo -n "  Building hub..."
    _tb=$(date +%s)
    if ! (cd "$REPO_DIR/hub" && npm run build >/dev/null 2>&1); then
        echo -e " ${RED}failed${NC}"
        echo -e "    Run manually: cd $REPO_DIR/hub && npm run build"
        exit 1
    fi
    echo -e " ${GREEN}done${NC} ($(($(date +%s) - _tb))s)"
fi
if is_platform_managed hub; then
    platform_start "Hub (port $HUB_PORT)" "hub"
else
    start_service "Hub (port $HUB_PORT)" "hub" env PORT="$HUB_PORT" \
        RELAY_STATUS_FILE="$DATA_DIR/relay-status.json" \
        RELAYGENT_KB_DIR="$KB_DIR" RELAYGENT_DATA_DIR="$DATA_DIR" \
        RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" node "$REPO_DIR/hub/ws-server.mjs"
fi
verify_service "Hub" "${HUB_SCHEME}://localhost:$HUB_PORT/" 5 || true

# Notifications
if is_platform_managed notifications; then
    platform_start "Notifications (port $NOTIF_PORT)" "notifications"
else
    ensure_venv "$REPO_DIR/notifications"
    start_service "Notifications (port $NOTIF_PORT)" "notifications" \
        "$REPO_DIR/notifications/.venv/bin/python3" "$REPO_DIR/notifications/server.py"
fi
verify_service "Notifications" "http://localhost:$NOTIF_PORT/health" 3 || true

# Optional services
if [ -f "$HOME/.relaygent/slack/app-token" ]; then
    if is_platform_managed slack-socket; then
        platform_start "Slack socket" "slack-socket"
    else
        start_service "Slack socket" "slack-socket" node "$REPO_DIR/notifications/slack-socket-listener.mjs"
    fi
fi
if [ -f "$HOME/.relaygent/gmail/credentials.json" ]; then
    if is_platform_managed email-poller; then
        platform_start "Email poller" "email-poller"
    else
        start_service "Email poller" "email-poller" env HUB_PORT="$HUB_PORT" node "$REPO_DIR/email/email-poller.mjs"
    fi
fi

# Relay — fast auth check (no API call, instant)
if ! command -v claude &>/dev/null; then
    echo -e "  Relay: ${RED}Claude Code not installed. Run: npm install -g @anthropic-ai/claude-code${NC}"
elif [ ! -d "$HOME/.claude" ]; then
    echo -e "  Relay: ${YELLOW}Not authenticated — run 'claude' to log in first.${NC}"
elif is_platform_managed relay; then
    platform_start "Relay" "relay"
else
    start_service "Relay" "relay" python3 "$REPO_DIR/harness/relay.py"
fi

_elapsed=$(($(date +%s) - _T0))
echo -e "\n  Dashboard: ${CYAN}${HUB_SCHEME}://localhost:$HUB_PORT/${NC}"
echo -e "  Logs:      $REPO_DIR/logs/"
echo -e "  Ready in ${_elapsed}s"
echo -e "  ${CYAN}Troubleshoot: relaygent check${NC}\n"
{ sleep 2 && { [ "$(uname)" = "Darwin" ] && open "${HUB_SCHEME}://localhost:$HUB_PORT/" 2>/dev/null || \
    { command -v xdg-open &>/dev/null && [ -n "${DISPLAY:-}" ] && xdg-open "${HUB_SCHEME}://localhost:$HUB_PORT/" 2>/dev/null; }; }; } &

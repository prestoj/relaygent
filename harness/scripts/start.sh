#!/usr/bin/env bash
# relaygent start — launch all services
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

load_config
echo -e "${CYAN}Starting Relaygent...${NC}"

# Check critical dependencies
if [ ! -d "$REPO_DIR/hub/node_modules" ]; then
    echo -e "  ${RED}Hub dependencies not installed.${NC}"
    echo -e "  Run: ${CYAN}relaygent update${NC} (installs deps and builds hub)"
    exit 1
fi

# Port checks
port_ok=true
check_port "$HUB_PORT" "Hub" || port_ok=false
check_port "$NOTIF_PORT" "Notifications" || port_ok=false
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
            Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >> "$REPO_DIR/logs/relaygent-xvfb.log" 2>&1 &
            echo $! > "$PID_DIR/xvfb.pid"
            sleep 0.5
            echo -e "  Xvfb: ${GREEN}started${NC} (DISPLAY=:99)"
        else
            echo -e "  Computer-use: ${YELLOW}no DISPLAY set and Xvfb not found${NC}"
        fi
    fi
    if [ -n "${DISPLAY:-}" ]; then
        check_port "$HS_PORT" "Computer-use" || port_ok=false
        if [ "$port_ok" = true ]; then
            start_service "Computer-use (port $HS_PORT)" "computer-use" \
                env DISPLAY="${DISPLAY:-:0}" python3 "$REPO_DIR/computer-use/linux-server.py"
            sleep 0.5
            if ! curl -sf "http://localhost:$HS_PORT/health" >/dev/null 2>&1; then
                echo -e "    ${YELLOW}Warning: server started but /health not responding${NC}"
            fi
        fi
    fi
else
    echo -e "  Computer-use: ${YELLOW}unavailable (unsupported platform)${NC}"
fi

# Hub — build if needed
if [ ! -d "$REPO_DIR/hub/build" ]; then
    echo "  Building hub..."
    (cd "$REPO_DIR/hub" && npm run build >/dev/null 2>&1)
fi
start_service "Hub (port $HUB_PORT)" "hub" env PORT="$HUB_PORT" \
    RELAY_STATUS_FILE="$REPO_DIR/data/relay-status.json" \
    RELAYGENT_KB_DIR="$KB_DIR" RELAYGENT_DATA_DIR="$REPO_DIR/data" \
    RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" node "$REPO_DIR/hub/ws-server.mjs"
verify_service "Hub" "http://localhost:$HUB_PORT/" 5 || true

# Notifications
ensure_venv "$REPO_DIR/notifications"
start_service "Notifications (port $NOTIF_PORT)" "notifications" \
    "$REPO_DIR/notifications/.venv/bin/python3" "$REPO_DIR/notifications/server.py"
verify_service "Notifications" "http://localhost:$NOTIF_PORT/health" 3 || true

# Optional services
[ -f "$HOME/.relaygent/slack/app-token" ] && \
    start_service "Slack socket" "slack-socket" node "$REPO_DIR/notifications/slack-socket-listener.mjs"
[ -f "$HOME/.relaygent/gmail/credentials.json" ] && \
    start_service "Email poller" "email-poller" env HUB_PORT="$HUB_PORT" node "$REPO_DIR/email/email-poller.mjs"

# Relay — verify Claude auth before starting
if ! claude -p 'hi' >/dev/null 2>&1; then
    echo -e "  Relay: ${RED}Claude not authenticated. Run 'claude' to log in first.${NC}"
elif [ "$(uname)" = "Linux" ] && systemctl --user is-enabled relaygent-relay &>/dev/null; then
    systemctl --user start relaygent-relay 2>/dev/null
    echo -e "  Relay: ${GREEN}managed by systemd${NC}"
elif [ "$(uname)" = "Darwin" ] && launchctl list 2>/dev/null | grep -q com.relaygent.relay; then
    echo -e "  Relay: ${GREEN}managed by LaunchAgent${NC}"
else
    start_service "Relay" "relay" python3 "$REPO_DIR/harness/relay.py"
fi

echo -e "\n  Dashboard: ${CYAN}http://localhost:$HUB_PORT/${NC}\n  Logs: $REPO_DIR/logs/\n"
{ sleep 2 && { [ "$(uname)" = "Darwin" ] && open "http://localhost:$HUB_PORT/" 2>/dev/null || \
    { command -v xdg-open &>/dev/null && [ -n "${DISPLAY:-}" ] && xdg-open "http://localhost:$HUB_PORT/" 2>/dev/null; }; }; } &

#!/bin/bash
# Restart hub and background daemons without platform service managers.
# Used by update.sh on Linux, Docker, or macOS without LaunchAgents.
# Expects lib.sh to be sourced and load_config called before sourcing this.
set -euo pipefail

# --- Stop existing hub ---
HUB_PID_FILE="$PID_DIR/hub.pid"
if [ -f "$HUB_PID_FILE" ] && kill -0 "$(cat "$HUB_PID_FILE")" 2>/dev/null; then
    HUB_PID=$(cat "$HUB_PID_FILE")
    pkill -TERM -P "$HUB_PID" 2>/dev/null || true
    kill -TERM "$HUB_PID" 2>/dev/null || true
    for _ in 1 2 3; do kill -0 "$HUB_PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$HUB_PID" 2>/dev/null && kill -9 "$HUB_PID" 2>/dev/null || true
fi
rm -f "$HUB_PID_FILE"
PORT_PIDS=$(port_pids "$HUB_PORT" || true)
if [ -n "$PORT_PIDS" ]; then
    kill -TERM $PORT_PIDS 2>/dev/null || true
    sleep 1
    kill -9 $PORT_PIDS 2>/dev/null || true
fi

# --- Start hub ---
mkdir -p "$REPO_DIR/logs"
PORT="$HUB_PORT" RELAY_STATUS_FILE="$DATA_DIR/relay-status.json" RELAYGENT_KB_DIR="$KB_DIR" \
    RELAYGENT_DATA_DIR="$DATA_DIR" RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" \
    node "$REPO_DIR/hub/ws-server.mjs" >> "$REPO_DIR/logs/relaygent-hub.log" 2>&1 &
echo $! > "$HUB_PID_FILE"
echo -e "  Hub: ${GREEN}restarted on :$HUB_PORT${NC}"

# --- Restart background daemons ---
echo -e "  Restarting daemons..."
for pat in "notifications/server.py" "slack-socket-listener" "email-poller" "notification-poller" "linux-server.py"; do
    pkill -f "$pat" 2>/dev/null || true
done
sleep 2
if [ -d "$REPO_DIR/notifications/.venv" ]; then
    RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" "$REPO_DIR/notifications/.venv/bin/python3" \
        "$REPO_DIR/notifications/server.py" >> "$REPO_DIR/logs/relaygent-notifications.log" 2>&1 &
    echo $! > "$PID_DIR/notifications.pid"
fi
if [ -f "$HOME/.relaygent/slack/app-token" ]; then
    node "$REPO_DIR/notifications/slack-socket-listener.mjs" >> "$REPO_DIR/logs/relaygent-slack-socket.log" 2>&1 &
    echo $! > "$PID_DIR/slack-socket.pid"
fi
if [ -f "$HOME/.relaygent/gmail/credentials.json" ]; then
    HUB_PORT="$HUB_PORT" node "$REPO_DIR/email/email-poller.mjs" >> "$REPO_DIR/logs/relaygent-email-poller.log" 2>&1 &
    echo $! > "$PID_DIR/email-poller.pid"
fi
if [ "$(uname)" = "Linux" ] && [ -n "${DISPLAY:-}" ] && [ -f "$REPO_DIR/computer-use/linux-server.py" ]; then
    DISPLAY="${DISPLAY:-:0}" python3 "$REPO_DIR/computer-use/linux-server.py" >> "$REPO_DIR/logs/relaygent-computer-use.log" 2>&1 &
    echo $! > "$PID_DIR/computer-use.pid"
fi
echo -e "  Daemons: ${GREEN}restarted${NC}"

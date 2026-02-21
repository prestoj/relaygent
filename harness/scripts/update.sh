#!/bin/bash
# Relaygent update — pull latest code, rebuild hub, and restart it
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
PID_DIR="$HOME/.relaygent"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}Updating Relaygent...${NC}"

# Stash uncommitted changes to avoid losing work
STASHED=false
if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain 2>/dev/null)" ]; then
    git -C "$SCRIPT_DIR" stash push -m "relaygent-update-$(date +%s)" -q 2>/dev/null && STASHED=true
    [ "$STASHED" = true ] && echo -e "  ${YELLOW}Stashed uncommitted changes${NC}"
fi
# Switch to main if on a different branch
ORIG_BRANCH=$(git -C "$SCRIPT_DIR" branch --show-current 2>/dev/null || echo "")
if [ -n "$ORIG_BRANCH" ] && [ "$ORIG_BRANCH" != "main" ]; then
    echo -e "  ${YELLOW}Switching from $ORIG_BRANCH to main${NC}"
    git -C "$SCRIPT_DIR" checkout main -q 2>/dev/null || true
fi
# Pull latest — ff-only preferred, fall back to fetch+reset if diverged
BEFORE=$(git -C "$SCRIPT_DIR" rev-parse HEAD)
if ! git -C "$SCRIPT_DIR" pull --ff-only 2>/dev/null; then
    echo -e "  ${YELLOW}Local diverged from origin/main — resetting${NC}"
    git -C "$SCRIPT_DIR" fetch origin main
    git -C "$SCRIPT_DIR" reset --hard origin/main
fi
AFTER=$(git -C "$SCRIPT_DIR" rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    echo -e "  ${YELLOW}Already up to date (rebuilding hub anyway)${NC}"
else
    echo -e "  ${GREEN}Updated:${NC}"
    git -C "$SCRIPT_DIR" log --oneline "${BEFORE}..${AFTER}" | while IFS= read -r line; do echo "    $line"; done
fi

# Install deps for all services (fast no-op when already up to date)
for svc in hub notifications computer-use email slack secrets; do
    [ -f "$SCRIPT_DIR/$svc/package.json" ] && npm install -q --prefix "$SCRIPT_DIR/$svc" 2>/dev/null
done
# Update Python venv if requirements changed
NOTIF_VENV="$SCRIPT_DIR/notifications/.venv"
if [ -d "$NOTIF_VENV" ] && [ -f "$SCRIPT_DIR/notifications/requirements.txt" ]; then
    "$NOTIF_VENV/bin/pip" install -q -r "$SCRIPT_DIR/notifications/requirements.txt" 2>/dev/null || true
fi

# Rebuild hub
echo -e "  Rebuilding hub..."
if (cd "$SCRIPT_DIR/hub" && npx vite build >/dev/null 2>&1); then
    echo -e "  Hub: ${GREEN}built${NC}"
    git -C "$SCRIPT_DIR" rev-parse HEAD > "$SCRIPT_DIR/data/hub-build-commit" 2>/dev/null || true
else
    echo -e "  Hub: ${RED}build failed — check logs${NC}"
    exit 1
fi

# Read hub port, notifications port, and KB dir from config
HUB_PORT=8080
NOTIF_PORT=8083
KB_DIR="$SCRIPT_DIR/knowledge/topics"
if [ -f "$CONFIG_FILE" ]; then
    HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
    NOTIF_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['notifications']['port'])" 2>/dev/null || echo 8083)
    KB_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['kb'])" 2>/dev/null || echo "$SCRIPT_DIR/knowledge/topics")
fi

# Stop running hub (pid file first, then port-based fallback)
HUB_PID_FILE="$PID_DIR/hub.pid"
if [ -f "$HUB_PID_FILE" ] && kill -0 "$(cat "$HUB_PID_FILE")" 2>/dev/null; then
    HUB_PID=$(cat "$HUB_PID_FILE")
    pkill -TERM -P "$HUB_PID" 2>/dev/null || true
    kill -TERM "$HUB_PID" 2>/dev/null || true
    for _ in 1 2 3; do kill -0 "$HUB_PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$HUB_PID" 2>/dev/null && kill -9 "$HUB_PID" 2>/dev/null || true
fi
rm -f "$HUB_PID_FILE"
# Fallback: kill any process still on the hub port (catches stale pid file case)
PORT_PIDS=$(lsof -iTCP:"$HUB_PORT" -sTCP:LISTEN -t 2>/dev/null || ss -tlnp 2>/dev/null | grep ":$HUB_PORT " | grep -oP 'pid=\K[0-9]+' || true)
if [ -n "$PORT_PIDS" ]; then
    kill -TERM $PORT_PIDS 2>/dev/null || true
    sleep 1
    kill -9 $PORT_PIDS 2>/dev/null || true
fi

# Start hub with new build
# On macOS with LaunchAgent, KeepAlive auto-restarts the killed hub.
# On Linux (or no LaunchAgent), manually start a new process.
if [ "$(uname)" = "Darwin" ] && launchctl list com.relaygent.hub &>/dev/null; then
    sleep 2  # Give LaunchAgent time to restart
    echo -e "  Hub: ${GREEN}restarted via LaunchAgent on :$HUB_PORT${NC}"
else
    mkdir -p "$SCRIPT_DIR/logs"
    PORT="$HUB_PORT" RELAY_STATUS_FILE="$SCRIPT_DIR/data/relay-status.json" RELAYGENT_KB_DIR="$KB_DIR" \
        RELAYGENT_DATA_DIR="$SCRIPT_DIR/data" RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" \
        node "$SCRIPT_DIR/hub/ws-server.mjs" >> "$SCRIPT_DIR/logs/relaygent-hub.log" 2>&1 &
    echo $! > "$HUB_PID_FILE"
    echo -e "  Hub: ${GREEN}restarted on :$HUB_PORT${NC}"
fi

# Restart background daemons so they pick up new code
echo -e "  Restarting daemons..."
for pat in "notifications/server.py" "slack-socket-listener" "email-poller" "notification-poller"; do
    pkill -f "$pat" 2>/dev/null || true
done
sleep 2

# On macOS, LaunchAgent KeepAlive auto-restarts killed processes.
# On Linux (no LaunchAgents), manually restart.
if [ "$(uname)" != "Darwin" ]; then
    if [ -d "$SCRIPT_DIR/notifications/.venv" ]; then
        RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" "$SCRIPT_DIR/notifications/.venv/bin/python3" \
            "$SCRIPT_DIR/notifications/server.py" >> "$SCRIPT_DIR/logs/relaygent-notifications.log" 2>&1 &
        echo $! > "$PID_DIR/notifications.pid"
    fi
    if [ -f "$HOME/.relaygent/slack/app-token" ]; then
        node "$SCRIPT_DIR/notifications/slack-socket-listener.mjs" >> "$SCRIPT_DIR/logs/relaygent-slack-socket.log" 2>&1 &
        echo $! > "$PID_DIR/slack-socket.pid"
    fi
    if [ -f "$HOME/.relaygent/gmail/credentials.json" ]; then
        HUB_PORT="$HUB_PORT" node "$SCRIPT_DIR/email/email-poller.mjs" >> "$SCRIPT_DIR/logs/relaygent-email-poller.log" 2>&1 &
        echo $! > "$PID_DIR/email-poller.pid"
    fi
fi
echo -e "  Daemons: ${GREEN}restarted${NC}"

# Check if MCP server source files changed (agents need to restart their session)
MCP_CHANGED=false
if [ "$BEFORE" != "$AFTER" ]; then
    if git -C "$SCRIPT_DIR" diff --name-only "${BEFORE}..${AFTER}" | grep -qE '(mcp-server|browser-tools|browser-exprs|cdp|hammerspoon)\.mjs$'; then
        MCP_CHANGED=true
    fi
fi
if [ "$MCP_CHANGED" = true ]; then
    echo -e "\n  ${YELLOW}NOTE: MCP server source files changed. MCP servers cache code at"
    echo -e "  session start — restart your Claude Code session to pick up changes.${NC}"
fi

# Clean up old logs
bash "$SCRIPT_DIR/harness/scripts/clean-logs.sh" 2>/dev/null || true

# Restore stashed changes if we stashed earlier
if [ "$STASHED" = true ]; then
    if git -C "$SCRIPT_DIR" stash pop -q 2>/dev/null; then
        echo -e "  ${GREEN}Restored stashed changes${NC}"
    else
        echo -e "  ${YELLOW}Could not auto-restore stash (conflicts?) — use: git stash pop${NC}"
    fi
fi

echo -e "\n  ${GREEN}Done.${NC}"

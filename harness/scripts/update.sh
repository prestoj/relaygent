#!/bin/bash
# Relaygent update — pull latest code, rebuild hub, and restart it
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

echo -e "${CYAN}Updating Relaygent...${NC}"

# Stash uncommitted changes to avoid losing work
STASHED=false
if [ -n "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]; then
    git -C "$REPO_DIR" stash push -m "relaygent-update-$(date +%s)" -q 2>/dev/null && STASHED=true
    [ "$STASHED" = true ] && echo -e "  ${YELLOW}Stashed uncommitted changes${NC}"
fi
# Switch to main if on a different branch
ORIG_BRANCH=$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo "")
if [ -n "$ORIG_BRANCH" ] && [ "$ORIG_BRANCH" != "main" ]; then
    echo -e "  ${YELLOW}Switching from $ORIG_BRANCH to main${NC}"
    git -C "$REPO_DIR" checkout main -q 2>/dev/null || true
fi
# Pull latest — ff-only preferred, fall back to fetch+reset if diverged
BEFORE=$(git -C "$REPO_DIR" rev-parse HEAD)
if ! git -C "$REPO_DIR" pull --ff-only 2>/dev/null; then
    echo -e "  ${YELLOW}Local diverged from origin/main — resetting${NC}"
    git -C "$REPO_DIR" fetch origin main
    git -C "$REPO_DIR" reset --hard origin/main
fi
AFTER=$(git -C "$REPO_DIR" rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    echo -e "  ${YELLOW}Already up to date (rebuilding hub anyway)${NC}"
else
    echo -e "  ${GREEN}Updated:${NC}"
    git -C "$REPO_DIR" log --oneline "${BEFORE}..${AFTER}" | while IFS= read -r line; do echo "    $line"; done
fi

# Install deps for all services (fast no-op when already up to date)
for svc in hub notifications computer-use email slack secrets; do
    [ -f "$REPO_DIR/$svc/package.json" ] && npm install -q --prefix "$REPO_DIR/$svc" 2>/dev/null
done
# Update Python venv if requirements changed
NOTIF_VENV="$REPO_DIR/notifications/.venv"
if [ -d "$NOTIF_VENV" ] && [ -f "$REPO_DIR/notifications/requirements.txt" ]; then
    "$NOTIF_VENV/bin/pip" install -q -r "$REPO_DIR/notifications/requirements.txt" 2>/dev/null || true
fi

# Rebuild hub
echo -e "  Rebuilding hub..."
if (cd "$REPO_DIR/hub" && npx vite build >/dev/null 2>&1); then
    echo -e "  Hub: ${GREEN}built${NC}"
    git -C "$REPO_DIR" rev-parse HEAD > "$REPO_DIR/data/hub-build-commit" 2>/dev/null || true
else
    echo -e "  Hub: ${RED}build failed — check logs${NC}"
    exit 1
fi

load_config

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
PORT_PIDS=$(port_pids "$HUB_PORT" || true)
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
    mkdir -p "$REPO_DIR/logs"
    PORT="$HUB_PORT" RELAY_STATUS_FILE="$DATA_DIR/relay-status.json" RELAYGENT_KB_DIR="$KB_DIR" \
        RELAYGENT_DATA_DIR="$DATA_DIR" RELAYGENT_NOTIFICATIONS_PORT="$NOTIF_PORT" \
        node "$REPO_DIR/hub/ws-server.mjs" >> "$REPO_DIR/logs/relaygent-hub.log" 2>&1 &
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
fi
echo -e "  Daemons: ${GREEN}restarted${NC}"

# Check if MCP server source files changed (agents need to restart their session)
MCP_CHANGED=false
if [ "$BEFORE" != "$AFTER" ]; then
    if git -C "$REPO_DIR" diff --name-only "${BEFORE}..${AFTER}" | grep -qE '(mcp-server|browser-tools|browser-exprs|cdp|hammerspoon)\.mjs$'; then
        MCP_CHANGED=true
    fi
fi
if [ "$MCP_CHANGED" = true ]; then
    echo -e "\n  ${YELLOW}NOTE: MCP server source files changed. MCP servers cache code at"
    echo -e "  session start — restart your Claude Code session to pick up changes.${NC}"
fi

# Clean up old logs
bash "$REPO_DIR/harness/scripts/clean-logs.sh" 2>/dev/null || true

# Restore stashed changes if we stashed earlier
if [ "$STASHED" = true ]; then
    if git -C "$REPO_DIR" stash pop -q 2>/dev/null; then
        echo -e "  ${GREEN}Restored stashed changes${NC}"
    else
        echo -e "  ${YELLOW}Could not auto-restore stash (conflicts?) — use: git stash pop${NC}"
    fi
fi

echo -e "\n  ${GREEN}Done.${NC}"

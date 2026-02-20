#!/bin/bash
# Relaygent update — pull latest code, rebuild hub, and restart it
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
PID_DIR="$HOME/.relaygent"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}Updating Relaygent...${NC}"

# Pull latest
BEFORE=$(git -C "$SCRIPT_DIR" rev-parse HEAD)
git -C "$SCRIPT_DIR" pull --ff-only
AFTER=$(git -C "$SCRIPT_DIR" rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    echo -e "  ${YELLOW}Already up to date (rebuilding hub anyway)${NC}"
else
    echo -e "  ${GREEN}Updated:${NC}"
    git -C "$SCRIPT_DIR" log --oneline "${BEFORE}..${AFTER}" | while IFS= read -r line; do echo "    $line"; done
fi

# Rebuild hub
echo -e "  Rebuilding hub..."
if npm install -q --prefix "$SCRIPT_DIR/hub" && npm run build --prefix "$SCRIPT_DIR/hub" >/dev/null 2>&1; then
    echo -e "  Hub: ${GREEN}built${NC}"
    git -C "$SCRIPT_DIR" rev-parse HEAD > "$SCRIPT_DIR/data/hub-build-commit" 2>/dev/null || true
else
    echo -e "  Hub: ${RED}build failed — check logs${NC}"
    exit 1
fi

# Read hub port and KB dir from config
HUB_PORT=8080
KB_DIR="$SCRIPT_DIR/knowledge/topics"
if [ -f "$CONFIG_FILE" ]; then
    HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
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
PORT_PIDS=$(lsof -iTCP:"$HUB_PORT" -sTCP:LISTEN -t 2>/dev/null || ss -tlnp "sport = :$HUB_PORT" 2>/dev/null | awk 'NR>1{match($0,/pid=([0-9]+)/,a); if(a[1]) print a[1]}')
if [ -n "$PORT_PIDS" ]; then
    kill -TERM $PORT_PIDS 2>/dev/null || true
    sleep 1
    kill -9 $PORT_PIDS 2>/dev/null || true
fi

# Start hub with new build
mkdir -p "$SCRIPT_DIR/logs"
PORT="$HUB_PORT" RELAY_STATUS_FILE="$SCRIPT_DIR/data/relay-status.json" RELAYGENT_KB_DIR="$KB_DIR" \
    node "$SCRIPT_DIR/hub/server.js" >> "$SCRIPT_DIR/logs/relaygent-hub.log" 2>&1 &
echo $! > "$HUB_PID_FILE"

echo -e "  Hub: ${GREEN}restarted on :$HUB_PORT${NC}"
echo -e "\n  ${GREEN}Done.${NC}"

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
    echo -e "  ${YELLOW}Already up to date.${NC}"
    exit 0
fi

echo -e "  ${GREEN}Updated:${NC}"
git -C "$SCRIPT_DIR" log --oneline "${BEFORE}..${AFTER}" | while IFS= read -r line; do echo "    $line"; done

# Rebuild hub
echo -e "  Rebuilding hub..."
if npm install -q --prefix "$SCRIPT_DIR/hub" && npm run build --prefix "$SCRIPT_DIR/hub" >/dev/null 2>&1; then
    echo -e "  Hub: ${GREEN}built${NC}"
else
    echo -e "  Hub: ${RED}build failed — check logs${NC}"
    exit 1
fi

# Read hub port from config
HUB_PORT=8080
if [ -f "$CONFIG_FILE" ]; then
    HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
fi

# Stop running hub
HUB_PID_FILE="$PID_DIR/hub.pid"
if [ -f "$HUB_PID_FILE" ] && kill -0 "$(cat "$HUB_PID_FILE")" 2>/dev/null; then
    HUB_PID=$(cat "$HUB_PID_FILE")
    pkill -TERM -P "$HUB_PID" 2>/dev/null || true
    kill -TERM "$HUB_PID" 2>/dev/null || true
    for _ in 1 2 3; do kill -0 "$HUB_PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$HUB_PID" 2>/dev/null && kill -9 "$HUB_PID" 2>/dev/null || true
fi
rm -f "$HUB_PID_FILE"

# Start hub with new build
mkdir -p "$SCRIPT_DIR/logs"
PORT="$HUB_PORT" RELAY_STATUS_FILE="$SCRIPT_DIR/data/relay-status.json" \
    node "$SCRIPT_DIR/hub/server.js" >> "$SCRIPT_DIR/logs/relaygent-hub.log" 2>&1 &
echo $! > "$HUB_PID_FILE"

echo -e "  Hub: ${GREEN}restarted on :$HUB_PORT${NC}"
echo -e "\n  ${GREEN}Done.${NC}"

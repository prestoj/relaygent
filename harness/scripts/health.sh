#!/bin/bash
# Relaygent health check — verify all services are responding
set -euo pipefail

CONFIG_FILE="$HOME/.relaygent/config.json"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ALL_OK=true

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Not set up yet. Run: relaygent start${NC}"; exit 1
fi

HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
NOTIF_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['notifications']['port'])" 2>/dev/null || echo 8083)
HS_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services'].get('hammerspoon',{}).get('port',8097))" 2>/dev/null || echo 8097)

echo -e "${CYAN}Relaygent Health Check${NC}"

check_http() {
    local name=$1 url=$2 timeout=${3:-2}
    if curl -sf --max-time "$timeout" "$url" >/dev/null 2>&1; then
        echo -e "  $name: ${GREEN}healthy${NC}"
    else
        echo -e "  $name: ${RED}unreachable${NC}"
        ALL_OK=false
    fi
}

check_process() {
    local name=$1 pattern=$2
    if pgrep -f "$pattern" >/dev/null 2>&1; then
        echo -e "  $name: ${GREEN}running${NC}"
    else
        echo -e "  $name: ${YELLOW}not running${NC}"
    fi
}

# Services with HTTP endpoints
check_http "Hub (:$HUB_PORT)" "http://localhost:$HUB_PORT/"
check_http "Notifications (:$NOTIF_PORT)" "http://localhost:$NOTIF_PORT/health"
if [ "$(uname)" = "Darwin" ]; then
    check_http "Hammerspoon (:$HS_PORT)" "http://localhost:$HS_PORT/health"
fi

# Background daemons
check_process "Notification poller" "notification-poller"
check_process "Slack socket" "slack-socket-listener"
[ -f "$HOME/.relaygent/gmail/credentials.json" ] && check_process "Email poller" "email-poller"

# Relay harness
check_process "Relay harness" "relay.py"

# Computer-use (platform-specific)
if [ "$(uname)" = "Linux" ]; then
    check_http "Computer-use (:$HS_PORT)" "http://localhost:$HS_PORT/health"
    if [ -n "${DISPLAY:-}" ]; then
        if xdpyinfo -display "${DISPLAY}" &>/dev/null 2>&1; then
            echo -e "  Xvfb ($DISPLAY): ${GREEN}running${NC}"
        else
            echo -e "  Xvfb ($DISPLAY): ${RED}not running${NC}"; ALL_OK=false
        fi
    fi
fi

# Chrome CDP (optional)
if curl -sf --max-time 1 "http://localhost:9223/json/version" >/dev/null 2>&1; then
    TOTAL_CHROME=$(pgrep -cf "google-chrome" 2>/dev/null || true)
    CDP_CHROME=$(pgrep -cf "remote-debugging-port" 2>/dev/null || true)
    STALE=$((${TOTAL_CHROME:-0} - ${CDP_CHROME:-0}))
    MSG="Chrome CDP (9223): ${GREEN}available${NC}"
    [ "$STALE" -gt 0 ] 2>/dev/null && MSG="$MSG ${YELLOW}($STALE stale instance(s))${NC}"
    echo -e "  $MSG"
else
    echo -e "  Chrome CDP (9223): ${YELLOW}not running${NC}"
fi

# Integrations
if [ -f "$HOME/.relaygent/linear/api-key" ]; then
    KEY=$(cat "$HOME/.relaygent/linear/api-key")
    if curl -sf --max-time 3 -H "Authorization: $KEY" -H "Content-Type: application/json" \
        -d '{"query":"{ viewer { id } }"}' https://api.linear.app/graphql >/dev/null 2>&1; then
        echo -e "  Linear API: ${GREEN}authenticated${NC}"
    else
        echo -e "  Linear API: ${RED}auth failed${NC}"; ALL_OK=false
    fi
else
    echo -e "  Linear API: ${YELLOW}not configured${NC}"
fi
if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null 2>&1; then
        echo -e "  GitHub CLI: ${GREEN}authenticated${NC}"
    else
        echo -e "  GitHub CLI: ${RED}not authenticated${NC}"; ALL_OK=false
    fi
fi

# Slack socket listener
SLACK_CACHE="/tmp/relaygent-slack-socket-cache.json"
if pgrep -f "slack-socket-listener" >/dev/null 2>&1; then
    if [ -f "$SLACK_CACHE" ]; then
        AGE=$(( $(date +%s) - $(stat -c %Y "$SLACK_CACHE" 2>/dev/null || date +%s) ))
        if [ "$AGE" -gt 900 ]; then
            echo -e "  Slack socket: ${YELLOW}stale cache (${AGE}s old)${NC}"
        else
            echo -e "  Slack socket: ${GREEN}healthy${NC}"
        fi
    else
        echo -e "  Slack socket: ${YELLOW}running but no cache${NC}"
    fi
elif [ -f "$HOME/.relaygent/slack/app-token" ]; then
    echo -e "  Slack socket: ${RED}not running${NC}"; ALL_OK=false
fi

# Disk space
DISK_PCT=$(df -h ~ 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}')
if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -gt 90 ] 2>/dev/null; then
    echo -e "\n  ${RED}Disk: ${DISK_PCT}% used — running low!${NC}"; ALL_OK=false
elif [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -gt 80 ] 2>/dev/null; then
    echo -e "\n  ${YELLOW}Disk: ${DISK_PCT}% used${NC}"
else
    echo -e "\n  Disk: ${DISK_PCT:-?}% used"
fi

# Git repo state
if [ -d "$SCRIPT_DIR/.git" ]; then
    BRANCH=$(git -C "$SCRIPT_DIR" branch --show-current 2>/dev/null)
    if [ "$BRANCH" != "main" ]; then
        echo -e "  ${YELLOW}Git: on branch '$BRANCH' (not main)${NC}"
    fi
    MOD=$(git -C "$SCRIPT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [ "${MOD:-0}" -gt 0 ] && echo -e "  ${YELLOW}Git: $MOD uncommitted change(s)${NC}"
fi

echo ""
if [ "$ALL_OK" = true ]; then
    echo -e "  ${GREEN}All critical services healthy.${NC}"
else
    echo -e "  ${RED}Some services need attention.${NC}"
    exit 1
fi

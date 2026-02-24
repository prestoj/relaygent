#!/bin/bash
# relaygent status — show what's running
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
load_config

echo -e "${CYAN}Relaygent Status${NC}"
check_process "Relay" "relay"
check_process "Hub" "hub" "$HUB_PORT"
check_process "Notifications" "notifications" "$NOTIF_PORT"
check_process "Slack-socket" "slack-socket"
check_process "Email-poller" "email-poller"

if [ "$(uname)" = "Darwin" ]; then
    pgrep -x Hammerspoon >/dev/null 2>&1 \
        && echo -e "  Hammerspoon: ${GREEN}running${NC}" \
        || echo -e "  Hammerspoon: ${RED}stopped${NC}"
else
    check_process "Computer-use" "computer-use"
    check_process "Xvfb" "xvfb"
fi

nc -z localhost 5900 2>/dev/null \
    && echo -e "  VNC: ${GREEN}listening :5900${NC}" \
    || echo -e "  VNC: ${YELLOW}not listening${NC}"

[[ -n "$TLS_HOSTNAME" ]] && echo -e "\n  Remote: ${CYAN}https://${TLS_HOSTNAME}:${HUB_PORT}/${NC}"

# Agent state + context fill
STATUS_FILE="${DATA_DIR:-$REPO_DIR/data}/relay-status.json"
if [ -f "$STATUS_FILE" ]; then
    read -r AGENT_ST UPDATED <<< "$(python3 -c "
import json,sys
from datetime import datetime as D
d=json.load(open('$STATUS_FILE'))
s=d.get('status','unknown')
u=d.get('updated','')
try:
 dt=D.fromisoformat(u); elapsed=int((D.now(dt.tzinfo)-dt).total_seconds())
 h,m=divmod(elapsed//60,60); t=f'{h}h{m:02d}m' if h else f'{m}m'
except: t='?'
print(s,t)
" 2>/dev/null || echo "unknown ?")"
    case "$AGENT_ST" in
        working)  echo -e "\n  Agent: ${GREEN}$AGENT_ST${NC} (${UPDATED} in state)" ;;
        sleeping) echo -e "\n  Agent: ${YELLOW}$AGENT_ST${NC} (${UPDATED})" ;;
        *)        echo -e "\n  Agent: $AGENT_ST" ;;
    esac
fi

PCT_FILE="/tmp/relaygent-context-pct"
if [ -f "$PCT_FILE" ]; then
    PCT=$(cat "$PCT_FILE" 2>/dev/null || echo "0")
    if [ "${PCT:-0}" -ge 85 ] 2>/dev/null; then
        echo -e "  Context: ${RED}${PCT}%${NC} (wrapping up)"
    elif [ "${PCT:-0}" -ge 50 ] 2>/dev/null; then
        echo -e "  Context: ${YELLOW}${PCT}%${NC}"
    else
        echo -e "  Context: ${PCT}%"
    fi
fi

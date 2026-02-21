#!/usr/bin/env bash
# relaygent stop — stop all services
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

load_config 2>/dev/null || true
echo -e "${CYAN}Stopping Relaygent...${NC}"

# Relay (systemd or pid)
systemctl --user stop relaygent-relay.service 2>/dev/null || true
stop_process "Relay" "relay"

# Claude sessions spawned by relay
claude_pids=$(pgrep -f "claude.*--print.*--session-id" 2>/dev/null) || true
[ -n "$claude_pids" ] && kill -TERM $claude_pids 2>/dev/null && echo -e "  Claude: ${YELLOW}cleaned up${NC}" || true

# All managed services
for svc in Computer-use:computer-use Hub:hub Notifications:notifications Slack-socket:slack-socket Email-poller:email-poller; do
    stop_process "${svc%%:*}" "${svc##*:}"
done
stop_process "Xvfb" "xvfb"

# Kill orphan processes on known ports
for pn in "${HUB_PORT:-8080}:Hub" "${NOTIF_PORT:-8083}:Notifications"; do
    pids=$(port_pids "${pn%%:*}") || true
    [ -n "$pids" ] && kill $pids 2>/dev/null && echo -e "  ${pn##*:} orphan: ${YELLOW}killed${NC}" || true
done

# MCP servers and Chrome
mpids=$(pgrep -f "mcp-chat\.mjs|mcp-server\.mjs|notification-poller" 2>/dev/null) || true
[ -n "$mpids" ] && kill $mpids 2>/dev/null || true
pkill -f google-chrome 2>/dev/null && echo -e "  Chrome: ${YELLOW}stopped${NC}" || true
rm -f "$REPO_DIR/harness/.relay.lock"

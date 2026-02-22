#!/usr/bin/env bash
# relaygent stop — stop all services
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

load_config 2>/dev/null || true
echo -e "${CYAN}Stopping Relaygent...${NC}"

# Stop platform-managed services first (systemd on Linux, LaunchAgents on macOS)
if [ "$(uname)" = "Darwin" ]; then
    GUID="gui/$(id -u)"
    for label in com.relaygent.relay com.relaygent.hub com.relaygent.notifications \
                 com.relaygent.slack-socket com.relaygent.email-poller; do
        plist="$HOME/Library/LaunchAgents/${label}.plist"
        [ -f "$plist" ] && launchctl bootout "$GUID" "$plist" 2>/dev/null || true
    done
else
    for unit in relaygent-relay relaygent-hub relaygent-notifications \
                relaygent-slack-socket relaygent-email-poller; do
        systemctl --user stop "${unit}.service" 2>/dev/null || true
    done
fi

# Relay (pid-based fallback)
stop_process "Relay" "relay"

# Claude sessions spawned by relay
claude_pids=$(pgrep -f "claude.*--print.*--session-id" 2>/dev/null) || true
[ -n "$claude_pids" ] && kill -TERM $claude_pids 2>/dev/null && echo -e "  Claude: ${YELLOW}cleaned up${NC}" || true

# All managed services (pid-based fallback)
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

echo -e "\n  ${GREEN}All services stopped.${NC}"

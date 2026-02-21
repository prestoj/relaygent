#!/bin/bash
# Install macOS LaunchAgents for relaygent services.
# Gives KeepAlive (auto-restart on crash) and RunAtLoad (start on login).
#
# Usage:
#   scripts/install-launchagents.sh              # install all
#   scripts/install-launchagents.sh --uninstall  # remove all
#   scripts/install-launchagents.sh --status     # show LaunchAgent status
#
# On Linux, prints systemd/cron guidance instead.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
AGENTS_DIR="$HOME/Library/LaunchAgents"
NODE="$(command -v node 2>/dev/null || echo "/opt/homebrew/bin/node")"
PYTHON3="$(command -v python3 2>/dev/null || echo "/usr/bin/python3")"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

if [ "$(uname)" != "Darwin" ]; then
    echo -e "${YELLOW}LaunchAgents are macOS-only.${NC}"
    echo "On Linux, use: scripts/install-systemd-services.sh (or: relaygent install-services)"
    exit 1
fi

# Parse config
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Config not found. Run ./setup.sh first.${NC}"; exit 1
fi
HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
NOTIF_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['notifications']['port'])" 2>/dev/null || echo 8083)
KB_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['kb'])" 2>/dev/null || echo "$REPO_DIR/knowledge/topics")
DATA_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['data'])" 2>/dev/null || echo "$REPO_DIR/data")
NOTIF_VENV="$REPO_DIR/notifications/.venv/bin/python3"
GUID="gui/$(id -u)"

write_plist() {
    local label=$1 program=$2 args=$3 env_extra=$4
    local plist="$AGENTS_DIR/${label}.plist"
    local logfile="$REPO_DIR/logs/relaygent-$(echo "$label" | sed 's/com\.relaygent\.//')\.log"
    mkdir -p "$AGENTS_DIR" "$REPO_DIR/logs"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${program}</string>
        <string>${args}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME</string>
        <key>PATH</key>
        <string>$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
${env_extra}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logfile}</string>
    <key>StandardErrorPath</key>
    <string>${logfile}</string>
</dict>
</plist>
EOF
    launchctl bootout "$GUID" "$plist" 2>/dev/null || true
    launchctl bootstrap "$GUID" "$plist"
    echo -e "  ${label}: ${GREEN}installed${NC}"
}

do_install() {
    echo -e "${CYAN}Installing LaunchAgents...${NC}"

    # Hub
    write_plist "com.relaygent.hub" "$NODE" "$REPO_DIR/hub/ws-server.mjs" \
"        <key>PORT</key>
        <string>$HUB_PORT</string>
        <key>RELAYGENT_KB_DIR</key>
        <string>$KB_DIR</string>
        <key>RELAYGENT_DATA_DIR</key>
        <string>$DATA_DIR</string>
        <key>RELAY_STATUS_FILE</key>
        <string>$REPO_DIR/data/relay-status.json</string>
        <key>RELAYGENT_NOTIFICATIONS_PORT</key>
        <string>$NOTIF_PORT</string>"

    # Notifications
    if [ -x "$NOTIF_VENV" ]; then
        write_plist "com.relaygent.notifications" "$NOTIF_VENV" \
            "$REPO_DIR/notifications/server.py" \
"        <key>RELAYGENT_NOTIFICATIONS_PORT</key>
        <string>$NOTIF_PORT</string>"
    else
        echo -e "  com.relaygent.notifications: ${YELLOW}skipped (no venv)${NC}"
    fi

    # Slack socket (optional)
    if [ -f "$HOME/.relaygent/slack/app-token" ]; then
        write_plist "com.relaygent.slack-socket" "$NODE" \
            "$REPO_DIR/notifications/slack-socket-listener.mjs" ""
    else
        echo -e "  com.relaygent.slack-socket: ${YELLOW}skipped (no Slack token)${NC}"
    fi

    # Email poller (optional)
    if [ -f "$HOME/.relaygent/gmail/credentials.json" ]; then
        write_plist "com.relaygent.email-poller" "$NODE" \
            "$REPO_DIR/email/email-poller.mjs" \
"        <key>HUB_PORT</key>
        <string>$HUB_PORT</string>"
    else
        echo -e "  com.relaygent.email-poller: ${YELLOW}skipped (no Gmail creds)${NC}"
    fi

    echo -e "\n  ${GREEN}Done.${NC} Services auto-restart on crash and start on login."
    echo -e "  Uninstall: $0 --uninstall"
}

do_uninstall() {
    echo -e "${CYAN}Removing LaunchAgents...${NC}"
    for label in com.relaygent.hub com.relaygent.notifications com.relaygent.slack-socket com.relaygent.email-poller; do
        local plist="$AGENTS_DIR/${label}.plist"
        if [ -f "$plist" ]; then
            launchctl bootout "$GUID" "$plist" 2>/dev/null || true
            rm -f "$plist"
            echo -e "  ${label}: ${YELLOW}removed${NC}"
        fi
    done
    echo -e "\n  ${GREEN}Done.${NC} Use 'relaygent start' for manual process management."
}

do_status() {
    echo -e "${CYAN}LaunchAgent Status${NC}"
    local all_agents; all_agents=$(launchctl list 2>/dev/null)
    for label in com.relaygent.hub com.relaygent.notifications com.relaygent.slack-socket com.relaygent.email-poller com.relaygent.hub-autobuild; do
        local line; line=$(echo "$all_agents" | grep "	${label}$" 2>/dev/null || true)
        if [ -n "$line" ]; then
            local pid; pid=$(echo "$line" | awk '{print $1}')
            [ "$pid" = "-" ] && pid="idle"
            echo -e "  ${label}: ${GREEN}loaded${NC} (${pid})"
        elif [ -f "$AGENTS_DIR/${label}.plist" ]; then
            echo -e "  ${label}: ${RED}plist exists but not loaded${NC}"
        else
            echo -e "  ${label}: ${YELLOW}not installed${NC}"
        fi
    done
}

case "${1:-install}" in
    --uninstall|-u) do_uninstall ;;
    --status|-s)    do_status ;;
    *)              do_install ;;
esac

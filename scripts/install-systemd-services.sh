#!/bin/bash
# Install systemd user services for relaygent (Linux only).
# Mirrors install-launchagents.sh — gives auto-restart + start on login.
#
# Usage:
#   scripts/install-systemd-services.sh              # install all
#   scripts/install-systemd-services.sh --uninstall  # remove all
#   scripts/install-systemd-services.sh --status     # show service status

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
UNIT_DIR="$HOME/.config/systemd/user"
ENV_FILE="$HOME/.relaygent/service.env"
NODE="$(command -v node 2>/dev/null || echo "/usr/bin/node")"
PYTHON3="$(command -v python3 2>/dev/null || echo "/usr/bin/python3")"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

if [ "$(uname)" = "Darwin" ]; then
    echo "systemd is Linux-only. On macOS use: scripts/install-launchagents.sh"
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Config not found. Run ./setup.sh first.${NC}"; exit 1
fi

# Parse config
HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
NOTIF_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['notifications']['port'])" 2>/dev/null || echo 8083)
HS_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('services',{}).get('hammerspoon',{}).get('port',8097))" 2>/dev/null || echo 8097)
KB_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['kb'])" 2>/dev/null || echo "$REPO_DIR/knowledge/topics")
DATA_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['data'])" 2>/dev/null || echo "$REPO_DIR/data")
NOTIF_VENV="$REPO_DIR/notifications/.venv/bin/python3"

write_env() {
    mkdir -p "$(dirname "$ENV_FILE")"
    cat > "$ENV_FILE" <<EOF
HOME=$HOME
PATH=$HOME/.local/bin:$HOME/.claude/local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin
PORT=$HUB_PORT
RELAYGENT_KB_DIR=$KB_DIR
RELAYGENT_DATA_DIR=$DATA_DIR
RELAY_STATUS_FILE=$REPO_DIR/data/relay-status.json
RELAYGENT_NOTIFICATIONS_PORT=$NOTIF_PORT
HAMMERSPOON_PORT=$HS_PORT
HUB_PORT=$HUB_PORT
EOF
    chmod 600 "$ENV_FILE"
}

write_unit() {
    local name=$1 exec_cmd=$2 desc=$3
    local logfile="$REPO_DIR/logs/relaygent-${name}.log"
    mkdir -p "$UNIT_DIR" "$REPO_DIR/logs"
    cat > "$UNIT_DIR/relaygent-${name}.service" <<UNIT
[Unit]
Description=Relaygent ${desc}
After=network.target

[Service]
Type=simple
ExecStart=${exec_cmd}
EnvironmentFile=$ENV_FILE
WorkingDirectory=$REPO_DIR
Restart=always
RestartSec=10
StandardOutput=append:${logfile}
StandardError=append:${logfile}

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable "relaygent-${name}.service" 2>/dev/null
    systemctl --user restart "relaygent-${name}.service"
    echo -e "  relaygent-${name}: ${GREEN}installed${NC}"
}

SERVICES="hub notifications relay slack-socket email-poller"

do_install() {
    echo -e "${CYAN}Installing systemd user services...${NC}"
    write_env

    write_unit "hub" "$NODE $REPO_DIR/hub/ws-server.mjs" "hub dashboard"

    if [ -x "$NOTIF_VENV" ]; then
        write_unit "notifications" "$NOTIF_VENV $REPO_DIR/notifications/server.py" "notifications service"
    else
        echo -e "  relaygent-notifications: ${YELLOW}skipped (no venv)${NC}"
    fi

    write_unit "relay" "$PYTHON3 $REPO_DIR/harness/relay.py" "relay harness"

    if [ -f "$HOME/.relaygent/slack/app-token" ]; then
        write_unit "slack-socket" "$NODE $REPO_DIR/notifications/slack-socket-listener.mjs" "Slack listener"
    else
        echo -e "  relaygent-slack-socket: ${YELLOW}skipped (no Slack token)${NC}"
    fi

    if [ -f "$HOME/.relaygent/gmail/credentials.json" ]; then
        write_unit "email-poller" "$NODE $REPO_DIR/email/email-poller.mjs" "email poller"
    else
        echo -e "  relaygent-email-poller: ${YELLOW}skipped (no Gmail creds)${NC}"
    fi

    echo -e "\n  ${GREEN}Done.${NC} Services auto-restart on crash and start on login."
    echo -e "  Requires lingering: ${CYAN}loginctl enable-linger \$USER${NC}"
    echo -e "  Uninstall: $0 --uninstall"
}

do_uninstall() {
    echo -e "${CYAN}Removing systemd user services...${NC}"
    for name in $SERVICES; do
        local unit="relaygent-${name}.service"
        if [ -f "$UNIT_DIR/$unit" ]; then
            systemctl --user stop "$unit" 2>/dev/null || true
            systemctl --user disable "$unit" 2>/dev/null || true
            rm -f "$UNIT_DIR/$unit"
            echo -e "  ${unit}: ${YELLOW}removed${NC}"
        fi
    done
    rm -f "$ENV_FILE"
    systemctl --user daemon-reload
    echo -e "\n  ${GREEN}Done.${NC}"
}

do_status() {
    echo -e "${CYAN}Systemd Service Status${NC}"
    for name in $SERVICES; do
        local unit="relaygent-${name}.service"
        if systemctl --user is-active "$unit" >/dev/null 2>&1; then
            echo -e "  ${unit}: ${GREEN}active${NC}"
        elif [ -f "$UNIT_DIR/$unit" ]; then
            echo -e "  ${unit}: ${RED}inactive${NC}"
        else
            echo -e "  ${unit}: ${YELLOW}not installed${NC}"
        fi
    done
}

case "${1:-install}" in
    --uninstall|-u) do_uninstall ;;
    --status|-s)    do_status ;;
    *)              do_install ;;
esac

#!/usr/bin/env bash
# Install (or reinstall) the relaygent-relay systemd user service.
# Reads config from ~/.relaygent/config.json.
# Usage: scripts/install-relay-service.sh [--uninstall]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_NAME="relaygent-relay.service"
ENV_FILE="$HOME/.relaygent/relay.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ "${1:-}" = "--uninstall" ]; then
    systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
    systemctl --user disable "$UNIT_NAME" 2>/dev/null || true
    rm -f "$UNIT_DIR/$UNIT_NAME" "$ENV_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
    echo -e "${GREEN}Uninstalled $UNIT_NAME${NC}"
    exit 0
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Config not found at $CONFIG_FILE — run ./setup.sh first${NC}"
    exit 1
fi

# Generate env file from config
python3 - <<EOF
import json, os
c = json.load(open('$CONFIG_FILE'))
s = c['services']
lines = [
    f"RELAYGENT_KB_DIR={c['paths']['kb']}",
    f"RELAYGENT_DATA_DIR={c['paths']['data']}",
    f"RELAYGENT_HUB_PORT={c['hub']['port']}",
    f"RELAYGENT_NOTIFICATIONS_PORT={s['notifications']['port']}",
    f"HAMMERSPOON_PORT={s.get('hammerspoon', {}).get('port', 8097)}",
]
os.makedirs(os.path.dirname('$ENV_FILE'), exist_ok=True)
open('$ENV_FILE', 'w').write('\n'.join(lines) + '\n')
os.chmod('$ENV_FILE', 0o600)
print("  Env file written to $ENV_FILE")
EOF

# Write systemd unit
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT_NAME" <<UNIT
[Unit]
Description=Relaygent relay harness
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $SCRIPT_DIR/harness/relay.py
EnvironmentFile=$ENV_FILE
WorkingDirectory=$SCRIPT_DIR
Restart=always
RestartSec=10
StandardOutput=append:$SCRIPT_DIR/logs/relaygent-relay.log
StandardError=append:$SCRIPT_DIR/logs/relaygent-relay.log

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable "$UNIT_NAME"
systemctl --user restart "$UNIT_NAME"

echo -e "${GREEN}Installed and started $UNIT_NAME${NC}"
echo -e "  Status:  systemctl --user status $UNIT_NAME"
echo -e "  Logs:    journalctl --user -u $UNIT_NAME -f"
echo -e "  Stop:    systemctl --user stop $UNIT_NAME"

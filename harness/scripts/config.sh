#!/bin/bash
# Relaygent config — view and modify config.json from the CLI.
# Usage: relaygent config [get|set|unset|path] [key] [value]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config_soft 2>/dev/null || true

CONFIG_FILE="${RELAYGENT_DIR:-$HOME/.relaygent}/config.json"

python3 "$SCRIPT_DIR/config.py" "$CONFIG_FILE" "$@"

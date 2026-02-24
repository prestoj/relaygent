#!/bin/bash
# relaygent cost — estimate API costs from session token data
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/cost.py" "$@"

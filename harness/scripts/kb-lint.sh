#!/bin/bash
# Relaygent KB lint — check knowledge base health.
# Usage: relaygent kb-lint [--fix]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config_soft 2>/dev/null || true

if [[ -z "${KB_DIR:-}" ]] || [[ ! -d "$KB_DIR" ]]; then
    echo -e "${RED}KB directory not found. Run: relaygent setup${NC}" >&2
    exit 1
fi

python3 "$SCRIPT_DIR/kb-lint.py" "$KB_DIR" "$@"

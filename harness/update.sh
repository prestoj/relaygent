#!/bin/bash
# Relaygent update — pull latest code and rebuild hub
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}Updating Relaygent...${NC}"

# Pull latest
BEFORE=$(git -C "$SCRIPT_DIR" rev-parse HEAD)
git -C "$SCRIPT_DIR" pull --ff-only
AFTER=$(git -C "$SCRIPT_DIR" rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    echo -e "  ${YELLOW}Already up to date.${NC}"
else
    echo -e "  ${GREEN}Updated:${NC}"
    git -C "$SCRIPT_DIR" log --oneline "${BEFORE}..${AFTER}" | while IFS= read -r line; do echo "    $line"; done
fi

# Rebuild hub
echo -e "  Rebuilding hub..."
if npm install -q --prefix "$SCRIPT_DIR/hub" && npm run build --prefix "$SCRIPT_DIR/hub" >/dev/null 2>&1; then
    echo -e "  Hub: ${GREEN}built${NC}"
else
    echo -e "  Hub: ${RED}build failed — check logs${NC}"
    exit 1
fi

echo -e "\n  ${GREEN}Done.${NC} Run ${CYAN}relaygent restart${NC} to apply."

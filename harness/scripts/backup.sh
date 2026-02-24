#!/bin/bash
# Relaygent backup — archive KB, config, and shared data to a tarball.
# Usage: relaygent backup [output-path]
#   Default: ~/relaygent-backup-YYYY-MM-DD.tar.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config_soft 2>/dev/null || true

DATE=$(date '+%Y-%m-%d')
OUTPUT="${1:-$HOME/relaygent-backup-${DATE}.tar.gz}"

# Resolve to absolute path
[[ "$OUTPUT" != /* ]] && OUTPUT="$PWD/$OUTPUT"

echo -e "${CYAN}Relaygent Backup${NC}"
echo ""

# Build list of paths to include
PATHS=()
LABELS=()

# KB directory
if [[ -n "${KB_DIR:-}" ]] && [[ -d "$KB_DIR" ]]; then
    PATHS+=("$KB_DIR")
    LABELS+=("Knowledge base: $KB_DIR")
fi

# Config directory (~/.relaygent/)
CONFIG_DIR="$HOME/.relaygent"
if [[ -d "$CONFIG_DIR" ]]; then
    PATHS+=("$CONFIG_DIR")
    LABELS+=("Config: $CONFIG_DIR")
fi

# Shared files (data/shared/)
SHARED_DIR="${DATA_DIR:-$REPO_DIR/data}/shared"
if [[ -d "$SHARED_DIR" ]] && [[ -n "$(ls -A "$SHARED_DIR" 2>/dev/null)" ]]; then
    PATHS+=("$SHARED_DIR")
    LABELS+=("Shared files: $SHARED_DIR")
fi

# CLAUDE.md (user's machine context)
CLAUDE_MD="$HOME/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
    PATHS+=("$CLAUDE_MD")
    LABELS+=("CLAUDE.md: $CLAUDE_MD")
fi

# Last session summary
SUMMARY="${DATA_DIR:-$REPO_DIR/data}/last-session-summary.json"
if [[ -f "$SUMMARY" ]]; then
    PATHS+=("$SUMMARY")
    LABELS+=("Last session summary")
fi

if [[ ${#PATHS[@]} -eq 0 ]]; then
    echo -e "${RED}Nothing to back up — no KB, config, or shared files found.${NC}"
    exit 1
fi

echo "  Including:"
for label in "${LABELS[@]}"; do echo "    - $label"; done

# Create tarball
mkdir -p "$(dirname "$OUTPUT")"
tar czf "$OUTPUT" "${PATHS[@]}" 2>/dev/null

SIZE=$(du -h "$OUTPUT" 2>/dev/null | awk '{print $1}')
echo ""
echo -e "  ${GREEN}✓ Backup saved:${NC} $OUTPUT ($SIZE)"
echo ""
echo "  Restore: tar xzf $OUTPUT -C /"

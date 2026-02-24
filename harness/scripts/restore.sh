#!/bin/bash
# Relaygent restore — restore from a backup tarball.
# Usage: relaygent restore <backup-file> [--dry-run] [--yes]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

BACKUP=""
DRY_RUN=false
YES=false

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --yes|-y) YES=true ;;
        -*) echo -e "${RED}Unknown flag: $arg${NC}" >&2; exit 1 ;;
        *) BACKUP="$arg" ;;
    esac
done

if [[ -z "$BACKUP" ]]; then
    echo -e "${RED}Usage:${NC} relaygent restore <backup-file> [--dry-run] [--yes]"
    echo ""
    echo "  Restore KB, config, and data from a relaygent backup tarball."
    echo "  Use --dry-run to preview without extracting."
    exit 1
fi

if [[ ! -f "$BACKUP" ]]; then
    echo -e "${RED}Backup not found: $BACKUP${NC}" >&2
    exit 1
fi

echo -e "${CYAN}Relaygent Restore${NC}"
echo ""

# Show backup contents grouped by type
KB_COUNT=$(tar tzf "$BACKUP" 2>/dev/null | grep -c '/knowledge/\|/topics/' || true)
CONFIG_COUNT=$(tar tzf "$BACKUP" 2>/dev/null | grep -c '\.relaygent/' || true)
SHARED_COUNT=$(tar tzf "$BACKUP" 2>/dev/null | grep -c '/shared/' || true)
TOTAL=$(tar tzf "$BACKUP" 2>/dev/null | wc -l | tr -d ' ')

echo "  Backup: $(basename "$BACKUP")"
echo "  Size:   $(du -h "$BACKUP" 2>/dev/null | awk '{print $1}')"
echo ""
echo "  Contents:"
[[ $KB_COUNT -gt 0 ]] && echo "    Knowledge base: $KB_COUNT files"
[[ $CONFIG_COUNT -gt 0 ]] && echo "    Config:         $CONFIG_COUNT files"
[[ $SHARED_COUNT -gt 0 ]] && echo "    Shared files:   $SHARED_COUNT files"
tar tzf "$BACKUP" 2>/dev/null | grep -q 'CLAUDE.md' && echo "    CLAUDE.md:      yes"
tar tzf "$BACKUP" 2>/dev/null | grep -q 'last-session-summary' && echo "    Session summary: yes"
echo "    Total:          $TOTAL files"
echo ""

if [[ "$DRY_RUN" = true ]]; then
    echo "  Full file listing:"
    tar tzf "$BACKUP" 2>/dev/null | head -50 | while IFS= read -r f; do echo "    $f"; done
    REMAINING=$((TOTAL - 50))
    [[ $REMAINING -gt 0 ]] && echo "    ... and $REMAINING more"
    echo ""
    echo -e "  ${YELLOW}Dry run — no changes made.${NC}"
    exit 0
fi

if [[ "$YES" != true ]]; then
    echo -n "  Restore $TOTAL files to original paths? [y/N] "
    read -r REPLY
    [[ "$REPLY" =~ ^[Yy]$ ]] || { echo "  Cancelled."; exit 0; }
fi

echo ""
tar xzf "$BACKUP" -C / 2>&1 | head -5
echo -e "  ${GREEN}✓ Restored $TOTAL files from backup.${NC}"

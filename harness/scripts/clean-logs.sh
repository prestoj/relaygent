#!/bin/bash
# Relaygent log cleanup — rotate and remove old log files
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS_DIR="$SCRIPT_DIR/logs"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

DAYS=7
DRY_RUN=false
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=true ;;
        --days) shift; DAYS="${1:-7}" ;;
        [0-9]*) DAYS="$1" ;;
    esac
    shift
done

echo -e "${CYAN}Relaygent Log Cleanup${NC}"
echo -e "  Logs dir: $LOGS_DIR"
echo -e "  Removing: rotated logs and files older than ${DAYS} days"

if [ ! -d "$LOGS_DIR" ]; then
    echo -e "  ${YELLOW}No logs directory found${NC}"
    exit 0
fi

FREED=0
COUNT=0

# Remove rotated log files (*.1, *.2, etc.)
for f in "$LOGS_DIR"/*.[0-9]; do
    [ -f "$f" ] || continue
    SIZE=$(du -k "$f" 2>/dev/null | cut -f1)
    if [ "$DRY_RUN" = true ]; then
        echo -e "  ${YELLOW}would remove${NC}: $(basename "$f") (${SIZE}K)"
    else
        rm -f "$f"
    fi
    FREED=$((FREED + ${SIZE:-0}))
    COUNT=$((COUNT + 1))
done

# Remove old log files (older than N days)
while IFS= read -r f; do
    [ -f "$f" ] || continue
    SIZE=$(du -k "$f" 2>/dev/null | cut -f1)
    if [ "$DRY_RUN" = true ]; then
        echo -e "  ${YELLOW}would remove${NC}: $(basename "$f") (${SIZE}K)"
    else
        rm -f "$f"
    fi
    FREED=$((FREED + ${SIZE:-0}))
    COUNT=$((COUNT + 1))
done < <(find "$LOGS_DIR" -name "*.log" -mtime +"$DAYS" -type f 2>/dev/null)

# Truncate large active log files (>10MB) to last 1000 lines
for f in "$LOGS_DIR"/*.log; do
    [ -f "$f" ] || continue
    SIZE=$(du -k "$f" 2>/dev/null | cut -f1)
    if [ "${SIZE:-0}" -gt 10240 ] 2>/dev/null; then
        if [ "$DRY_RUN" = true ]; then
            echo -e "  ${YELLOW}would truncate${NC}: $(basename "$f") (${SIZE}K -> last 1000 lines)"
        else
            TAIL=$(tail -1000 "$f")
            echo "$TAIL" > "$f"
            NEW_SIZE=$(du -k "$f" 2>/dev/null | cut -f1)
            SAVED=$((SIZE - ${NEW_SIZE:-0}))
            FREED=$((FREED + SAVED))
            echo -e "  truncated: $(basename "$f") (saved ${SAVED}K)"
        fi
    fi
done

if [ "$COUNT" -gt 0 ] || [ "$FREED" -gt 0 ]; then
    FREED_MB=$((FREED / 1024))
    if [ "$DRY_RUN" = true ]; then
        echo -e "\n  ${YELLOW}Dry run: would free ~${FREED_MB}MB from $COUNT file(s)${NC}"
    else
        echo -e "\n  ${GREEN}Cleaned $COUNT file(s), freed ~${FREED_MB}MB${NC}"
    fi
else
    echo -e "\n  ${GREEN}Logs are clean — nothing to remove${NC}"
fi

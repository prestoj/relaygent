#!/bin/bash
# relaygent cleanup — remove old session data and logs to free disk space
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$SCRIPT_DIR/harness/scripts/lib.sh"
load_config_soft
# Read DATA_DIR and REPO_DIR from config (load_config_soft doesn't extract these)
eval "$(python3 -c "
import json,shlex
try:
 c=json.load(open('$CONFIG_FILE'));p=c['paths']
 print(f'DATA_DIR={shlex.quote(p.get(\"data\",\"\"))}')
 print(f'REPO_DIR={shlex.quote(p.get(\"repo\",\"\"))}')
except: pass
" 2>/dev/null)" || true

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'

DAYS=14
DRY_RUN=false
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=true ;;
        --days) shift; DAYS="${1:-14}" ;;
        [0-9]*) DAYS="$1" ;;
        -h|--help) echo "Usage: relaygent cleanup [--days N] [--dry-run]"; exit 0 ;;
    esac
    shift
done

echo -e "${CYAN}Relaygent Cleanup${NC}"
echo -e "  Removing data older than ${DAYS} days"
[ "$DRY_RUN" = true ] && echo -e "  ${YELLOW}DRY RUN — no files will be deleted${NC}"

# Show current disk usage
DISK_BEFORE=$(df -k "$HOME" 2>/dev/null | tail -1 | awk '{print $4}')
echo -e "\n${CYAN}Disk:${NC} $(df -h "$HOME" 2>/dev/null | tail -1 | awk '{printf "%s used of %s (%s)", $3, $2, $5}')"

TOTAL_FREED=0
TOTAL_COUNT=0

# --- 1. Clean old session JSONL dirs ---
echo -e "\n${CYAN}Session data:${NC}"
CLAUDE_PROJECTS="$HOME/.claude/projects"
if [ -d "$CLAUDE_PROJECTS" ]; then
    # Build prefix from config (matches how hub finds sessions)
    REPO_PATH="${REPO_DIR:-$SCRIPT_DIR}"
    RUNS_DIR="$REPO_PATH/harness/runs"
    PREFIX=$(echo "$RUNS_DIR" | sed 's|[/.]|-|g')

    CUTOFF=$(date -v-${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%d 2>/dev/null || echo "")
    if [ -z "$CUTOFF" ]; then
        echo -e "  ${YELLOW}Could not compute date cutoff, skipping${NC}"
    else
        SESSION_FREED=0
        SESSION_COUNT=0
        # Get the most recent dir (never delete it — might be current)
        LATEST=""
        for d in "$CLAUDE_PROJECTS"/${PREFIX}*; do
            [ -d "$d" ] || continue
            LATEST="$d"
        done

        for d in "$CLAUDE_PROJECTS"/${PREFIX}*; do
            [ -d "$d" ] || continue
            [ "$d" = "$LATEST" ] && continue
            # Extract date from dir name (format: ...-YYYY-MM-DD-HH-MM-SS)
            DIR_DATE=$(basename "$d" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | tail -1)
            [ -z "$DIR_DATE" ] && continue
            if [[ "$DIR_DATE" < "$CUTOFF" ]]; then
                SIZE=$(du -sk "$d" 2>/dev/null | cut -f1)
                SIZE=${SIZE:-0}
                if [ "$DRY_RUN" = true ]; then
                    echo -e "  ${YELLOW}would remove${NC}: $(basename "$d") ($(( SIZE / 1024 ))MB)"
                else
                    rm -rf "$d"
                    echo -e "  removed: $(basename "$d") ($(( SIZE / 1024 ))MB)"
                fi
                SESSION_FREED=$((SESSION_FREED + SIZE))
                SESSION_COUNT=$((SESSION_COUNT + 1))
            fi
        done

        if [ "$SESSION_COUNT" -gt 0 ]; then
            echo -e "  ${GREEN}${SESSION_COUNT} old session(s), ~$((SESSION_FREED / 1024))MB${NC}"
        else
            echo -e "  ${DIM}No old sessions to clean${NC}"
        fi
        TOTAL_FREED=$((TOTAL_FREED + SESSION_FREED))
        TOTAL_COUNT=$((TOTAL_COUNT + SESSION_COUNT))
    fi
else
    echo -e "  ${DIM}No session data found${NC}"
fi

# --- 2. Clean Chrome debug profile cache ---
echo -e "\n${CYAN}Chrome profile cache:${NC}"
CHROME_PROFILE="${DATA_DIR:-$SCRIPT_DIR/data}/chrome-debug-profile"
if [ -d "$CHROME_PROFILE" ]; then
    # Only clean cache subdirs — safe even if Chrome is running (it rebuilds them)
    CACHE_FREED=0
    for cache_dir in "$CHROME_PROFILE/Default/Cache" "$CHROME_PROFILE/Default/Code Cache" \
                     "$CHROME_PROFILE/Default/Service Worker/CacheStorage" \
                     "$CHROME_PROFILE/GrShaderCache" "$CHROME_PROFILE/ShaderCache"; do
        [ -d "$cache_dir" ] || continue
        SIZE=$(du -sk "$cache_dir" 2>/dev/null | cut -f1)
        SIZE=${SIZE:-0}
        [ "$SIZE" -lt 1024 ] && continue
        if [ "$DRY_RUN" = true ]; then
            echo -e "  ${YELLOW}would clean${NC}: $(basename "$cache_dir") ($(( SIZE / 1024 ))MB)"
        else
            rm -rf "$cache_dir"
            echo -e "  cleaned: $(basename "$cache_dir") ($(( SIZE / 1024 ))MB)"
        fi
        CACHE_FREED=$((CACHE_FREED + SIZE))
    done
    if [ "$CACHE_FREED" -gt 0 ]; then
        echo -e "  ${GREEN}~$((CACHE_FREED / 1024))MB${NC}"
        TOTAL_FREED=$((TOTAL_FREED + CACHE_FREED))
        TOTAL_COUNT=$((TOTAL_COUNT + 1))
    else
        echo -e "  ${DIM}Cache is small, nothing to clean${NC}"
    fi
else
    echo -e "  ${DIM}No Chrome profile found${NC}"
fi

# --- 3. Clean old logs ---
echo -e "\n${CYAN}Log files:${NC}"
DRY_FLAG=""
[ "$DRY_RUN" = true ] && DRY_FLAG="--dry-run"
bash "$SCRIPT_DIR/harness/scripts/clean-logs.sh" --days "$DAYS" $DRY_FLAG 2>&1 | grep -E '(would |removed|truncated|freed|clean)' || echo -e "  ${DIM}No old logs${NC}"

# --- Summary ---
echo ""
TOTAL_MB=$((TOTAL_FREED / 1024))
if [ "$TOTAL_MB" -gt 0 ]; then
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}Dry run: would free ~${TOTAL_MB}MB${NC}"
    else
        DISK_AFTER=$(df -k "$HOME" 2>/dev/null | tail -1 | awk '{print $4}')
        ACTUAL=$((( ${DISK_AFTER:-0} - ${DISK_BEFORE:-0} ) / 1024))
        echo -e "${GREEN}Freed ~${TOTAL_MB}MB${NC}"
        echo -e "Disk now: $(df -h "$HOME" 2>/dev/null | tail -1 | awk '{printf "%s used of %s (%s)", $3, $2, $5}')"
    fi
else
    echo -e "${GREEN}Everything is clean — no action needed${NC}"
fi

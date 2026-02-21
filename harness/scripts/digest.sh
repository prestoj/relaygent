#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$SCRIPT_DIR/harness/scripts/lib.sh"
load_config_soft

CYAN='\033[0;36m'; GREEN='\033[0;32m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'; YELLOW='\033[1;33m'

DAYS=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --days|-d) DAYS="${2:-1}"; shift 2 ;;
        --help|-h)
            echo -e "${CYAN}Usage:${NC} relaygent digest [--days N]"
            echo "  Generate a daily summary (default: last 24h)"
            exit 0 ;;
        *) shift ;;
    esac
done

SINCE="$(date -v-${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%d)"
LABEL="last 24 hours"
[[ "$DAYS" -gt 1 ]] && LABEL="last ${DAYS} days"

echo -e "${BOLD}${CYAN}Daily Digest${NC}  ${DIM}(${LABEL}, since ${SINCE})${NC}"
echo ""

# PRs
PR_COUNT=0
if command -v gh >/dev/null 2>&1; then
    PR_LIST=$(gh pr list --state merged --limit 50 \
        --json number,title,mergedAt \
        --jq "[.[] | select(.mergedAt >= \"${SINCE}\")] | length" 2>/dev/null || echo 0)
    PR_COUNT="${PR_LIST:-0}"
fi

# Sessions
SESSION_COUNT=0
RUNS_DIR="${HOME}/.claude/projects"
if [[ -d "$RUNS_DIR" ]]; then
    SESSION_COUNT=$(find "$RUNS_DIR" -maxdepth 2 -name "*.jsonl" -newer /dev/null 2>/dev/null | while read -r f; do
        DIR="$(basename "$(dirname "$f")")"
        if [[ "$DIR" =~ ^${SINCE//./\\.} ]]; then echo 1; fi
    done | wc -l | tr -d ' ')
    # Simpler: count dirs matching date prefix
    SESSION_COUNT=0
    for dir in "$RUNS_DIR"/*/; do
        DIRNAME="$(basename "$dir")"
        for sub in "$dir"*/; do
            SUBNAME="$(basename "$sub")"
            [[ "$SUBNAME" > "$SINCE" || "$SUBNAME" == "$SINCE"* ]] && SESSION_COUNT=$((SESSION_COUNT + 1))
        done 2>/dev/null
    done 2>/dev/null
fi

# Git stats
cd "$SCRIPT_DIR"
COMMITS=$(git rev-list --count --since="$SINCE" HEAD 2>/dev/null || echo 0)
FILES_CHANGED=$(git diff --stat "HEAD@{${DAYS} days ago}" HEAD 2>/dev/null | tail -1 | grep -oE '[0-9]+ file' | grep -oE '[0-9]+' || echo "?")

# Test count from last run
TEST_COUNT=""
if [[ -f "${DATA_DIR:-$SCRIPT_DIR/data}/test-results.txt" ]]; then
    TEST_COUNT=$(grep -oE '[0-9]+ pass' "${DATA_DIR:-$SCRIPT_DIR/data}/test-results.txt" 2>/dev/null | head -1 || echo "")
fi

# Output
echo -e "  ${GREEN}${PR_COUNT}${NC} PRs merged"
echo -e "  ${GREEN}${COMMITS}${NC} commits"
echo -e "  ${GREEN}${FILES_CHANGED}${NC} files changed"
echo ""

# Top PRs
if [[ $PR_COUNT -gt 0 ]]; then
    echo -e "${BOLD}Highlights${NC}"
    gh pr list --state merged --limit 5 \
        --json number,title,mergedAt \
        --jq ".[] | select(.mergedAt >= \"${SINCE}\") | \"  #\\(.number) \\(.title)\"" 2>/dev/null | head -5
    [[ $PR_COUNT -gt 5 ]] && echo -e "  ${DIM}...and $((PR_COUNT - 5)) more${NC}"
    echo ""
fi

# Disk
DISK_PCT=$(df -h ~ 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
if [[ "${DISK_PCT:-0}" -ge 85 ]]; then
    echo -e "  ${YELLOW}Disk: ${DISK_PCT}% used${NC}"
else
    echo -e "  ${DIM}Disk: ${DISK_PCT}% used${NC}"
fi

# Open PRs
OPEN_PRS=$(gh pr list --state open --json number --jq length 2>/dev/null || echo 0)
[[ "${OPEN_PRS:-0}" -gt 0 ]] && echo -e "  ${YELLOW}${OPEN_PRS} open PR(s) awaiting review${NC}"

echo ""
echo -e "${DIM}Run 'relaygent changelog --days ${DAYS}' for full details${NC}"

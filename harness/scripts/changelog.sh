#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'

DAYS=7
while [[ $# -gt 0 ]]; do
    case "$1" in
        --days|-d) DAYS="${2:-7}"; shift 2 ;;
        --help|-h)
            echo -e "${CYAN}Usage:${NC} relaygent changelog [--days N]"
            echo "  Show merged PRs and recent commits (default: last 7 days)"
            exit 0 ;;
        *) shift ;;
    esac
done

SINCE="$(date -v-${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%d)"

echo -e "${CYAN}Relaygent Changelog${NC}  ${DIM}(last ${DAYS} days, since ${SINCE})${NC}"
echo ""

cd "$SCRIPT_DIR"

# Merged PRs via gh CLI
PR_COUNT=0
echo -e "${BOLD}Merged PRs${NC}"
if command -v gh >/dev/null 2>&1; then
    while IFS=$'\t' read -r num title date; do
        [[ -z "$num" ]] && continue
        SHORT_DATE="${date%%T*}"
        echo -e "  ${GREEN}#${num}${NC} ${title} ${DIM}(${SHORT_DATE})${NC}"
        PR_COUNT=$((PR_COUNT + 1))
    done < <(gh pr list --state merged --limit 30 \
        --json number,title,mergedAt \
        --jq ".[] | select(.mergedAt >= \"${SINCE}\") | [.number,.title,.mergedAt] | @tsv" 2>/dev/null)
fi

if [[ $PR_COUNT -eq 0 ]]; then
    echo -e "  ${DIM}No merged PRs in this period${NC}"
fi
echo ""

# Direct commits (non-merge, on main)
DIRECT_COUNT=0
echo -e "${BOLD}Direct Commits${NC}"
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    HASH="${line%% *}"
    MSG="${line#* }"
    DIRECT_COUNT=$((DIRECT_COUNT + 1))
    echo -e "  ${DIM}${HASH}${NC} ${MSG}"
done < <(git log --no-merges --oneline --first-parent --since="$SINCE" 2>/dev/null | head -20)

if [[ $DIRECT_COUNT -eq 0 ]]; then
    echo -e "  ${DIM}No direct commits in this period${NC}"
fi
echo ""

# Summary
TOTAL=$(git rev-list --count --since="$SINCE" HEAD 2>/dev/null || echo 0)
AUTHORS=$(git log --since="$SINCE" --format='%aN' 2>/dev/null | sort -u | wc -l | tr -d ' ')
echo -e "${DIM}${PR_COUNT} PRs merged, ${TOTAL} total commits by ${AUTHORS} author(s)${NC}"

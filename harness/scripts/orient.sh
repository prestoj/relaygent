#!/bin/bash
# Relaygent orientation — quick system status snapshot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config
INTENT_FILE="$KB_DIR/INTENT.md"
HANDOFF_FILE="$KB_DIR/HANDOFF.md"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Relaygent Orientation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# INTENT
if [ -f "$INTENT_FILE" ]; then
    echo -e "\033[0;34m┌─ INTENT ───────────────────────────────────────────────┐\033[0m"
    # Strip YAML frontmatter and HTML comments, show content
    sed -n '/^---$/,/^---$/!p' "$INTENT_FILE" | grep -v '^<!--' | while IFS= read -r line; do
        echo -e "\033[0;34m│\033[0m $line"
    done
    echo -e "\033[0;34m└──────────────────────────────────────────────────────────┘\033[0m"
fi

# Time
echo -e "\n\033[0;34mTime:\033[0m $(date '+%Y-%m-%d %H:%M %Z')"

# Services
echo -e "\n\033[0;34mServices:\033[0m"
check_service() {
    local name=$1 url=$2
    if curl -s --max-time 2 "$url" >/dev/null 2>&1; then
        echo -e "  ✓ $name: \033[0;32mrunning\033[0m"
    else
        echo -e "  ✗ $name: \033[0;31mdown\033[0m"
    fi
}
check_service "Notifications" "http://127.0.0.1:${NOTIF_PORT}/health"
check_service "Hub" "http://127.0.0.1:${HUB_PORT}/api/health"
CU_NAME="Hammerspoon"; [ "$(uname)" = "Linux" ] && CU_NAME="Computer-use"
check_service "$CU_NAME" "http://127.0.0.1:${HS_PORT}/health"

# Crash context from previous session
CRASH_FILE="$DATA_DIR/crash-context.json"
if [ -f "$CRASH_FILE" ]; then
    python3 - "$CRASH_FILE" <<'PYEOF' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1]))
ts = d.get("timestamp", "?")[:19].replace("T", " ") + " UTC"
code, count = d.get("exit_code", "?"), d.get("crash_count", 0)
print(f'\n\033[1;31m⚠ Previous session crashed\033[0m (exit {code}, {count} crash(es), {ts})')
for l in d.get("last_log_lines", [])[-3:]:
    print(f'  \033[0;31m{l[:80]}\033[0m')
PYEOF
fi

# Notifications: unread chat, Slack, reminders
source "$SCRIPT_DIR/orient-notify.sh"

# Relay status + context
STATUS_FILE="$DATA_DIR/relay-status.json"
if [ -f "$STATUS_FILE" ]; then
    RELAY_ST=$(python3 -c "import json; d=json.load(open('$STATUS_FILE')); print(d.get('status','?'))" 2>/dev/null || echo "?")
    CTX_PCT=$(cat /tmp/relaygent-context-pct 2>/dev/null || echo "")
    RELAY_INFO="$RELAY_ST"; [ -n "$CTX_PCT" ] && RELAY_INFO="$RELAY_INFO, context ${CTX_PCT}%"
    echo -e "\n\033[0;34mRelay:\033[0m $RELAY_INFO"
fi
echo -e "\033[0;34mDisk:\033[0m $(df -h ~ 2>/dev/null | awk 'NR==2{print $5}')"
# Last session summary
if [ -f "$DATA_DIR/last-session-summary.json" ]; then
    python3 - "$DATA_DIR/last-session-summary.json" <<'PYEOF' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1])); t = d.get('tools', {})
top = '  '.join(f'{k}({v})' for k, v in list(t.items())[:5])
git = []
if d.get('git_commits'): git.append(f'{d["git_commits"]} commits')
if d.get('prs_created'): git.append(f'{len(d["prs_created"])} PRs created')
if d.get('prs_merged'): git.append(f'{len(d["prs_merged"])} PRs merged')
gs = f' | {", ".join(git)}' if git else ''
print(f'\033[0;34mLast Session:\033[0m {d["turns"]} turns, {d["context_pct"]:.0f}% ctx{gs} | {top}')
PYEOF
fi

# KB stats
if [ -d "$KB_DIR" ]; then
    TOPIC_COUNT=$(find "$KB_DIR" -name "*.md" -not -path "*/contacts/*" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "\033[0;34mKnowledge:\033[0m $TOPIC_COUNT topics"
fi

# Recent repo commits + branch + uncommitted changes
if [ -d "$REPO_DIR/.git" ]; then
    BRANCH=$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo "unknown")
    MODIFIED=$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    BRANCH_INFO="$BRANCH"
    [ "${MODIFIED:-0}" -gt 0 ] 2>/dev/null && BRANCH_INFO="$BRANCH, $MODIFIED uncommitted"
    echo -e "\033[0;34mRecent changes\033[0m (\033[0;33m${BRANCH_INFO}\033[0m):"
    # Show commits since HANDOFF was last written (context for this session), capped at 10
    if [ -f "$HANDOFF_FILE" ]; then
        SINCE=$(date -r "$HANDOFF_FILE" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null)
        NEW_COMMITS=$(git -C "$REPO_DIR" log --oneline --since="$SINCE" 2>/dev/null | head -10)
        if [ -n "$NEW_COMMITS" ]; then
            echo "$NEW_COMMITS" | while IFS= read -r line; do echo "  $line"; done
        else
            git -C "$REPO_DIR" log --oneline -3 2>/dev/null | while IFS= read -r line; do echo "  $line"; done
        fi
    else
        git -C "$REPO_DIR" log --oneline -3 2>/dev/null | while IFS= read -r line; do echo "  $line"; done
    fi
fi

# Open PRs
if command -v gh &>/dev/null; then
    PR_LIST=$(gh pr list --state open --json number,title,reviewDecision --jq '.[] | "  #\(.number): \(.title)\(if .reviewDecision == "APPROVED" then " ✓" elif .reviewDecision == "CHANGES_REQUESTED" then " ✗" else "" end)"' 2>/dev/null)
    if [ -n "$PR_LIST" ]; then
        echo -e "\033[0;34mOpen PRs:\033[0m"; echo "$PR_LIST"
    fi
fi

# Agent work status
TASKS_FILE="$KB_DIR/tasks.md"
if [ -f "$TASKS_FILE" ]; then
    python3 - "$TASKS_FILE" <<'PYEOF' 2>/dev/null
import re, sys
content = open(sys.argv[1]).read()
m = re.search(r'## Agent Work\n(.*?)(?=\n##|\Z)', content, re.DOTALL)
if m:
    lines = [l.strip() for l in m.group(1).strip().split('\n') if l.startswith('-')]
    if lines:
        print('\n\033[0;34mAgent Work:\033[0m')
        for l in lines: print(f'  {l}')
PYEOF
fi

# Due tasks
if [ -f "$TASKS_FILE" ]; then
    DUE_TASKS=$(python3 "$SCRIPT_DIR/due-tasks.py" "$TASKS_FILE" 2>/dev/null)
    [ -n "$DUE_TASKS" ] && echo "$DUE_TASKS"
fi

# Handoff
if [ -f "$HANDOFF_FILE" ]; then
    HANDOFF_LINES=$(wc -l < "$HANDOFF_FILE" | tr -d ' ')
    HANDOFF_MODIFIED=$(date -r "$HANDOFF_FILE" "+%H:%M" 2>/dev/null || stat -c "%y" "$HANDOFF_FILE" 2>/dev/null | awk '{print substr($2,1,5)}')
    # Staleness check: warn if handoff is >6 hours old
    HANDOFF_EPOCH=$(stat -f %m "$HANDOFF_FILE" 2>/dev/null || stat -c %Y "$HANDOFF_FILE" 2>/dev/null || echo 0)
    HANDOFF_AGE_H=$(( ($(date +%s) - HANDOFF_EPOCH) / 3600 ))
    STALE_TAG=""
    if [ "$HANDOFF_AGE_H" -ge 12 ] 2>/dev/null; then
        STALE_TAG=" \033[1;31m⚠ STALE (${HANDOFF_AGE_H}h old — info may be outdated)\033[0m"
    elif [ "$HANDOFF_AGE_H" -ge 6 ] 2>/dev/null; then
        STALE_TAG=" \033[1;33m⚠ ${HANDOFF_AGE_H}h old\033[0m"
    fi
    echo -e "\n\033[0;34mHandoff:\033[0m $HANDOFF_LINES lines, last updated ${HANDOFF_MODIFIED}${STALE_TAG}"
    # Show main goal
    GOAL=$(sed -n '/^#\{1,2\} MAIN GOAL/,/^#\{1,2\} [^M]/p' "$HANDOFF_FILE" | head -15)
    if [ -n "$GOAL" ]; then
        echo -e "\033[1;33m┌─ MAIN GOAL ─────────────────────────────────────────┐\033[0m"
        echo "$GOAL" | while IFS= read -r line; do
            echo -e "\033[1;33m│\033[0m $line"
        done
        echo -e "\033[1;33m└─────────────────────────────────────────────────────┘\033[0m"
    fi
fi

echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

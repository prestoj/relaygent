#!/bin/bash
# Relaygent orientation — quick system status snapshot
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
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
CU_NAME="Hammerspoon"
[ "$(uname)" = "Linux" ] && CU_NAME="Computer-use"
check_service "$CU_NAME" "http://127.0.0.1:${HS_PORT}/health"

# Unread chat messages
UNREAD=$(curl -s --max-time 2 "http://127.0.0.1:${HUB_PORT}/api/chat?mode=unread" 2>/dev/null)
UNREAD_COUNT=$(echo "$UNREAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo 0)
if [ "$UNREAD_COUNT" -gt 0 ] 2>/dev/null; then
    echo -e "\n\033[1;33mChat:\033[0m $UNREAD_COUNT unread message(s) — check with read_messages"
fi

# Unread Slack messages (from socket cache)
SLACK_CACHE="/tmp/relaygent-slack-socket-cache.json"
SLACK_ACK_FILE="$HOME/.relaygent/slack/.last_check_ts"
if [ -f "$SLACK_CACHE" ]; then
    python3 - "$SLACK_CACHE" "$SLACK_ACK_FILE" <<'EOF' 2>/dev/null
import json, sys
cache_path, ack_path = sys.argv[1], sys.argv[2]
try:
    cache = json.load(open(cache_path))
    ack_ts = 0
    try: ack_ts = float(open(ack_path).read().strip())
    except: pass
    msgs = [m for m in cache.get('messages', []) if float(m.get('ts', 0)) > ack_ts]
    if msgs:
        names = ', '.join(dict.fromkeys(m.get('channel_name', m.get('channel','?'))[:20] for m in msgs))
        print(f'\033[1;33mSlack:\033[0m {len(msgs)} unread ({names})')
        for m in msgs[-2:]:
            nm = m.get('channel_name', m.get('channel', '?'))
            print(f'  [{nm}] {(m.get("text") or "")[:60]}')
except: pass
EOF
fi

# Pending reminders
PENDING=$(curl -s --max-time 2 "http://127.0.0.1:${NOTIF_PORT}/upcoming" 2>/dev/null)
PENDING_COUNT=$(echo "$PENDING" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
if [ "$PENDING_COUNT" -gt 0 ] 2>/dev/null; then
    echo -e "\033[1;33mReminders:\033[0m $PENDING_COUNT due"
fi

# Relay status + context
STATUS_FILE="$REPO_DIR/data/relay-status.json"
if [ -f "$STATUS_FILE" ]; then
    RELAY_ST=$(python3 -c "import json; d=json.load(open('$STATUS_FILE')); print(d.get('status','?'))" 2>/dev/null || echo "?")
    CTX_PCT=$(cat /tmp/relaygent-context-pct 2>/dev/null || echo "")
    RELAY_INFO="$RELAY_ST"; [ -n "$CTX_PCT" ] && RELAY_INFO="$RELAY_INFO, context ${CTX_PCT}%"
    echo -e "\n\033[0;34mRelay:\033[0m $RELAY_INFO"
fi
DISK_USED=$(df -h ~ 2>/dev/null | awk 'NR==2{print $5}')
echo -e "\033[0;34mDisk:\033[0m ${DISK_USED:-unknown}"

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
    PR_LIST=$(gh pr list --state open --json number,title --jq '.[] | "  #\(.number): \(.title)"' 2>/dev/null)
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
TASKS_FILE="$KB_DIR/tasks.md"
if [ -f "$TASKS_FILE" ]; then
    DUE_TASKS=$(python3 -c "
import re
from datetime import datetime, timedelta
now = datetime.now()
freqs = {'6h': 0.25, '12h': 0.5, 'daily': 1, '2d': 2, '3d': 3, 'weekly': 7, 'monthly': 30}
due = []
for line in open('$TASKS_FILE'):
    m = re.match(r'- \[ \] (.+?)(?:\s*\|(.*))?$', line.strip())
    if not m: continue
    desc = m.group(1).strip()
    meta = {}
    for p in (m.group(2) or '').split('|'):
        kv = re.match(r'\s*(\w+):\s*(.+)', p.strip())
        if kv: meta[kv.group(1)] = kv.group(2).strip()
    ttype = meta.get('type', 'one-off')
    freq = meta.get('freq', '')
    last = meta.get('last', '')
    if ttype == 'one-off':
        due.append(desc)
    elif ttype == 'recurring' and freq:
        if not last or last == 'never':
            due.append(desc)
        else:
            try:
                last_dt = datetime.strptime(last, '%Y-%m-%d %H:%M')
                if now - last_dt >= timedelta(days=freqs.get(freq, 1)):
                    due.append(desc)
            except: pass
if due:
    print('\n\033[1;33mTasks due:\033[0m')
    for d in due[:5]: print(f'  • {d}')
else:
    print('\n\033[0;34mTasks:\033[0m nothing due')
" 2>/dev/null)
    [ -n "$DUE_TASKS" ] && echo "$DUE_TASKS"
fi

# Handoff
if [ -f "$HANDOFF_FILE" ]; then
    HANDOFF_LINES=$(wc -l < "$HANDOFF_FILE" | tr -d ' ')
    HANDOFF_MODIFIED=$(date -r "$HANDOFF_FILE" "+%H:%M" 2>/dev/null || stat -c "%y" "$HANDOFF_FILE" 2>/dev/null | awk '{print substr($2,1,5)}')
    echo -e "\n\033[0;34mHandoff:\033[0m $HANDOFF_LINES lines, last updated $HANDOFF_MODIFIED"
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

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

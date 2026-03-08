#!/bin/bash
# Orient notification display — unread chat, Slack, reminders
# Sourced by orient.sh (expects HUB_PORT, NOTIF_PORT, HOME from parent)

# Unread chat messages (show content so agent can skip read_messages call)
UNREAD=$(curl -s $CURL_K --max-time 2 "${HUB_SCHEME:-http}://127.0.0.1:${HUB_PORT}/api/chat?mode=unread" 2>/dev/null)
echo "$UNREAD" | python3 -c "
import sys,json
try:
 d=json.load(sys.stdin); msgs=d.get('messages',[])
 if msgs:
  print(f'\n\033[1;33mChat:\033[0m {len(msgs)} unread')
  for m in msgs[-5:]:
   r='You' if m.get('role')=='assistant' else 'User'; print(f'  [{r}] {(m.get(\"content\") or \"\")[:80]}')
except: pass
" 2>/dev/null

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
if [ -n "$PENDING" ] && [ "$PENDING" != "[]" ]; then
    echo "$PENDING" | python3 -c "
import sys, json
from datetime import datetime
reminders = json.load(sys.stdin)
now = datetime.now()
due, upcoming = [], []
for r in reminders:
    try:
        t = datetime.fromisoformat(r['trigger_time'])
        (due if t <= now else upcoming).append(r)
    except: upcoming.append(r)
parts = []
if due: parts.append(f'{len(due)} due')
if upcoming: parts.append(f'{len(upcoming)} upcoming')
if parts:
    print(f'\033[1;33mReminders:\033[0m ' + ', '.join(parts))
    for r in (due + upcoming)[:3]:
        msg = (r.get('message') or '?')[:60]
        tt = r.get('trigger_time', '?')
        tag = 'DUE' if r in due else tt
        print(f'  [{tag}] {msg}')
" 2>/dev/null
fi

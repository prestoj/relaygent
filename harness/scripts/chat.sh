#!/usr/bin/env bash
set -euo pipefail

# Send/read chat messages via hub API
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config_soft

PORT="${HUB_PORT:-8080}"
URL="http://localhost:$PORT/api/chat"
CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'; GREEN='\033[0;32m'

# Check hub is reachable
if ! curl -sf -o /dev/null "$URL?limit=1" 2>/dev/null; then
    echo -e "Error: Hub not reachable at localhost:$PORT\n  Run: ${CYAN}relaygent start${NC}" >&2; exit 1
fi

case "${1:---help}" in
    --read|-r)
        LIMIT="${2:-20}"
        python3 -c "
import json, sys, datetime as dt
msgs = json.load(sys.stdin).get('messages', [])
for m in reversed(msgs):
    role = 'You' if m['role'] == 'human' else 'Agent'
    ts = m.get('created_at', '')
    if ts:
        t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        ts = t.strftime('%H:%M')
    color = '\033[0;32m' if role == 'Agent' else '\033[0;36m'
    print(f'{color}{role}\033[0m \033[2m{ts}\033[0m {m.get(\"content\",\"\")[:200]}')
" < <(curl -sf "$URL?limit=$LIMIT")
        ;;
    --help|-h)
        echo -e "${CYAN}Usage:${NC} relaygent chat <message>"
        echo "       relaygent chat --read [N]    Show last N messages (default 20)"
        echo ""
        echo "Send messages to the agent via hub chat."
        ;;
    *)
        MSG="$*"
        python3 -c "import json,sys; sys.stdout.write(json.dumps({'content':' '.join(sys.argv[1:]),'role':'human'}))" "$@" \
            | curl -sf -X POST "$URL" -H 'Content-Type: application/json' -d @- > /dev/null
        echo -e "${GREEN}Message sent.${NC}"
        ;;
esac

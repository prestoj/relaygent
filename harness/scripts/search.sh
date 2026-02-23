#!/usr/bin/env bash
# relaygent search — search KB, sessions, and chat from the terminal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config_soft

HUB_PORT="${HUB_PORT:-8080}"

usage() {
    echo -e "${CYAN}Usage:${NC} relaygent search <query> [--type kb|sessions|chat]"
    echo "  Searches KB topics, sessions, and chat messages."
    echo "  --type    Filter to one result type (default: all)"
    echo "  --json    Output raw JSON"
    exit 0
}

[ $# -eq 0 ] && usage
QUERY="" TYPE_FILTER="" JSON_OUT=false
while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h) usage ;;
        --type) TYPE_FILTER="$2"; shift ;;
        --json) JSON_OUT=true ;;
        *) QUERY="$QUERY $1" ;;
    esac
    shift
done
QUERY="${QUERY## }"
[ -z "$QUERY" ] && usage

ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")
RESPONSE=$(curl -sf $CURL_K --max-time 5 "${HUB_SCHEME:-http}://127.0.0.1:${HUB_PORT}/api/search?q=${ENCODED}&full=1" 2>/dev/null) || {
    echo -e "${RED}Hub not reachable at port ${HUB_PORT}${NC}" >&2; exit 1
}

if $JSON_OUT; then echo "$RESPONSE"; exit 0; fi

python3 - "$RESPONSE" "$TYPE_FILTER" "$QUERY" <<'PYEOF'
import json, sys

data = json.loads(sys.argv[1])
type_filter = sys.argv[2]
query = sys.argv[3]
results = data.get("results", [])

C = "\033[0;36m"; G = "\033[0;32m"; Y = "\033[1;33m"; M = "\033[0;35m"
D = "\033[0;90m"; B = "\033[1m"; NC = "\033[0m"

if not results:
    print(f"No results for {B}{query}{NC}")
    sys.exit(0)

grouped = {}
for r in results:
    t = r.get("type", "other")
    grouped.setdefault(t, []).append(r)

count = 0
if (not type_filter or type_filter == "kb") and "topic" in grouped:
    print(f"\n{C}KB Topics:{NC}")
    for t in grouped["topic"]:
        tags = " ".join(f"#{x}" for x in t.get("tags", []))
        snip = t.get("snippet", "")[:80]
        print(f"  {B}{t['title']}{NC}  {D}{tags}{NC}")
        if snip:
            print(f"    {snip}")
        count += 1

if (not type_filter or type_filter == "sessions") and "session" in grouped:
    print(f"\n{G}Sessions:{NC}")
    for s in grouped["session"]:
        title = s.get("title", "")
        snip = s.get("snippet", "")[:100]
        print(f"  {B}{title}{NC}")
        if snip:
            print(f"    {snip}")
        count += 1

if (not type_filter or type_filter == "chat") and "chat" in grouped:
    print(f"\n{M}Chat:{NC}")
    for m in grouped["chat"]:
        role = m.get("role", "?")
        label = "You" if role == "assistant" else "User"
        snip = m.get("snippet", "")
        time_str = (m.get("time") or "")[:16]
        print(f"  {D}[{label} {time_str}]{NC} {snip}")
        count += 1

print(f"\n{D}{count} result(s) for \"{query}\"{NC}")
PYEOF

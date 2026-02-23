#!/bin/bash
# relaygent history — show recent agent session activity
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; DIM='\033[2m'; NC='\033[0m'; BOLD='\033[1m'

LIMIT=10
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--limit) LIMIT="$2"; shift 2 ;;
        --json) JSON=1; shift ;;
        -h|--help) echo "Usage: relaygent history [-n NUM] [--json]"; echo "  Show recent agent sessions (default: last 10)"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

URL="http://127.0.0.1:${HUB_PORT}/api/sessions?limit=${LIMIT}"
RESPONSE=$(curl -sf --max-time 5 "$URL" 2>/dev/null) || {
    echo -e "${YELLOW}Hub not reachable on :${HUB_PORT}${NC} — is it running?" >&2
    exit 1
}

if [ "${JSON:-0}" = "1" ]; then
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    exit 0
fi

python3 - "$RESPONSE" "$LIMIT" <<'PYEOF'
import json, sys, textwrap

data = json.loads(sys.argv[1])
limit = int(sys.argv[2])
sessions = data.get("sessions", [])
total = data.get("total", 0)

C = "\033[0;36m"; G = "\033[0;32m"; Y = "\033[1;33m"
D = "\033[2m"; B = "\033[1m"; N = "\033[0m"

if not sessions:
    print(f"{D}No sessions found.{N}")
    sys.exit(0)

print(f"{C}Recent Sessions{N} ({len(sessions)} of {total})\n")

for s in sessions:
    dur = s.get("durationMin", 0)
    tokens = s.get("tokens", 0)
    tools = s.get("tools", 0)
    time = s.get("time", "?")
    summary = s.get("summary") or ""

    # Format tokens
    if tokens >= 1_000_000:
        tok_str = f"{tokens / 1_000_000:.1f}M"
    elif tokens >= 1000:
        tok_str = f"{tokens // 1000}K"
    else:
        tok_str = str(tokens)

    # Format duration
    if dur >= 60:
        dur_str = f"{dur // 60}h{dur % 60:02d}m"
    else:
        dur_str = f"{dur}m"

    print(f"  {B}{time}{N}  {G}{dur_str}{N}  {tok_str} tokens  {tools} tools")
    if summary:
        wrapped = textwrap.shorten(summary, width=78, placeholder="...")
        print(f"    {D}{wrapped}{N}")
    print()

if total > len(sessions):
    print(f"{D}Use -n {total} to see all sessions{N}")
PYEOF

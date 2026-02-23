#!/usr/bin/env bash
# relaygent session — show live session stats from the hub API
set -euo pipefail
_SELF="${BASH_SOURCE[0]}"; SCRIPT_DIR="$(cd "$(dirname "$_SELF")/../.." && pwd)"
source "$SCRIPT_DIR/harness/scripts/lib.sh"
load_config

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'; BOLD='\033[1m'

HUB_URL="${HUB_SCHEME:-http}://127.0.0.1:${HUB_PORT:-8080}"

usage() { echo -e "${CYAN}Usage:${NC} relaygent session [--json]"; echo "  Show current agent session stats."; exit 0; }
[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && usage

DATA=$(curl -sf ${CURL_K:-} "$HUB_URL/api/session/live" 2>/dev/null) || { echo -e "${RED}Hub unreachable${NC}"; exit 1; }
JSON_FLAG=false; [[ "${1:-}" == "--json" ]] && { echo "$DATA"; exit 0; }

STATUS=$(echo "$DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','off'))" 2>/dev/null)
ACTIVE=$(echo "$DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('active', False))" 2>/dev/null)

if [[ "$ACTIVE" != "True" ]]; then
    echo -e "${CYAN}Session${NC}: ${DIM}no active session${NC} (status: $STATUS)"
    exit 0
fi

# Parse all fields
read -r TURNS TOOLS DURATION CTX FILES_MOD <<< "$(echo "$DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('turns',0), d.get('toolCalls',0), d.get('durationMin',0), d.get('contextPct',0), len(d.get('filesModified',[])))
" 2>/dev/null)"

# Duration formatting
if [[ "$DURATION" -ge 60 ]]; then DUR_FMT="$((DURATION/60))h$((DURATION%60))m"
elif [[ "$DURATION" -ge 1 ]]; then DUR_FMT="${DURATION}m"
else DUR_FMT="<1m"; fi

# Context color
if [[ "$CTX" -ge 85 ]]; then CTX_CLR="$RED"
elif [[ "$CTX" -ge 50 ]]; then CTX_CLR="$YELLOW"
else CTX_CLR="$GREEN"; fi

echo -e "${BOLD}${CYAN}Live Session${NC}"
echo -e "  Status:   ${GREEN}$STATUS${NC}  ($DUR_FMT)"
echo -e "  Context:  ${CTX_CLR}${CTX}%${NC}"
echo -e "  Turns:    $TURNS   Tools: $TOOLS   Files: $FILES_MOD"

# Top tools
TOP_TOOLS=$(echo "$DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
tt=d.get('topTools',{})
parts=[f'{k}({v})' for k,v in list(tt.items())[:6]]
print('  '.join(parts))
" 2>/dev/null)
[[ -n "$TOP_TOOLS" ]] && echo -e "  Tools:    ${DIM}${TOP_TOOLS}${NC}"

# Modified files
MOD_FILES=$(echo "$DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for f in d.get('filesModified',[])[:8]:
    parts=f.rsplit('/',2)
    print('  ' + '/'.join(parts[-2:]) if len(parts)>1 else '  '+f)
" 2>/dev/null)
[[ -n "$MOD_FILES" ]] && echo -e "  Modified:" && echo -e "${DIM}${MOD_FILES}${NC}"

# Recent activity
RECENT=$(echo "$DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d.get('recentTools',[])[:5]:
    n=r.get('name','?'); inp=r.get('input','')[:60]
    print(f'  {n}: {inp}')
" 2>/dev/null)
[[ -n "$RECENT" ]] && echo -e "  Recent:" && echo -e "${DIM}${RECENT}${NC}"

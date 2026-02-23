#!/usr/bin/env bash
# relaygent fleet — show status of all relaygent instances on the network
set -euo pipefail
_SELF="${BASH_SOURCE[0]}"; SCRIPT_DIR="$(cd "$(dirname "$_SELF")/../.." && pwd)"
source "$SCRIPT_DIR/harness/scripts/lib.sh"
load_config

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'; BOLD='\033[1m'

usage() { echo -e "${CYAN}Usage:${NC} relaygent fleet [--json]"; echo "  Show status of all configured relaygent instances."; exit 0; }
[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && usage

# Build fleet list: local + configured peers
LOCAL_URL="${HUB_SCHEME:-http}://127.0.0.1:${HUB_PORT:-8080}"
FLEET_JSON=$(python3 -c "
import json, os, sys
cfg_path = os.path.expanduser('~/.relaygent/config.json')
try:
    cfg = json.load(open(cfg_path))
    fleet = cfg.get('fleet', [])
except: fleet = []
# Always include local as first entry
local_url = '$LOCAL_URL'
local_name = '$(hostname -s 2>/dev/null || echo local)'
result = [{'name': local_name, 'url': local_url, 'local': True}]
for p in fleet:
    if p.get('url') and p.get('name'):
        result.append({'name': p['name'], 'url': p['url'], 'local': False})
print(json.dumps(result))
" 2>/dev/null) || { echo -e "${RED}Failed to read fleet config${NC}"; exit 1; }

PEER_COUNT=$(echo "$FLEET_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")

if [[ "${1:-}" == "--json" ]]; then
    # JSON output: query all peers and return array
    echo "$FLEET_JSON" | python3 -c "
import json, sys, subprocess
peers = json.load(sys.stdin)
results = []
for p in peers:
    url = p['url']
    try:
        h = json.loads(subprocess.run(['curl', '-sk', '--max-time', '3', f'{url}/api/health'], capture_output=True, text=True).stdout)
    except: h = {}
    try:
        s = json.loads(subprocess.run(['curl', '-sk', '--max-time', '3', f'{url}/api/session/live'], capture_output=True, text=True).stdout)
    except: s = {}
    results.append({**p, 'health': h, 'session': s})
print(json.dumps(results, indent=2))
"
    exit 0
fi

echo -e "${BOLD}${CYAN}Fleet Status${NC}  ($PEER_COUNT instance$([ "$PEER_COUNT" != "1" ] && echo s))\n"

# Query each peer
echo "$FLEET_JSON" | python3 -c "
import json, sys, subprocess

peers = json.load(sys.stdin)
G = '\033[0;32m'; Y = '\033[1;33m'; R = '\033[0;31m'; D = '\033[2m'; N = '\033[0m'; B = '\033[1m'; C = '\033[0;36m'

for p in peers:
    name = p['name']; url = p['url']; local = p.get('local', False)
    tag = f' {D}(local){N}' if local else ''

    # Query health
    try:
        hr = subprocess.run(['curl', '-sk', '--max-time', '3', f'{url}/api/health'], capture_output=True, text=True)
        h = json.loads(hr.stdout) if hr.returncode == 0 else {}
    except: h = {}

    if not h.get('status'):
        print(f'  {B}{name}{N}{tag}  {R}unreachable{N}')
        continue

    relay = h.get('relay', {})
    status = relay.get('status', 'off')
    ver = h.get('version', '?')[:7]
    hostname = h.get('hostname', name)

    if status == 'working': sc = G
    elif status == 'sleeping': sc = Y
    else: sc = D

    # Query live session
    try:
        sr = subprocess.run(['curl', '-sk', '--max-time', '3', f'{url}/api/session/live'], capture_output=True, text=True)
        s = json.loads(sr.stdout) if sr.returncode == 0 else {}
    except: s = {}

    ctx = s.get('contextPct', '')
    turns = s.get('turns', '')
    tools = s.get('toolCalls', '')
    dur = s.get('durationMin', 0)

    if dur >= 60: dur_s = f'{dur//60}h{dur%60}m'
    elif dur >= 1: dur_s = f'{dur}m'
    else: dur_s = '<1m' if s.get('active') else ''

    # Format context with color
    ctx_s = ''
    if ctx:
        if ctx >= 85: ctx_s = f'{R}{ctx}%{N}'
        elif ctx >= 50: ctx_s = f'{Y}{ctx}%{N}'
        else: ctx_s = f'{G}{ctx}%{N}'

    # Build info line
    parts = [f'{sc}{status}{N}']
    if dur_s: parts.append(dur_s)
    if ctx_s: parts.append(f'ctx:{ctx_s}')
    if turns: parts.append(f't:{turns}')
    if tools: parts.append(f'tools:{tools}')
    info = '  '.join(parts)

    # Top tools summary
    top = s.get('topTools', {})
    top_s = '  '.join(f'{k}({v})' for k, v in list(top.items())[:4]) if top else ''

    print(f'  {B}{hostname}{N}{tag}  {info}  {D}{ver}{N}')
    if top_s: print(f'    {D}{top_s}{N}')
"

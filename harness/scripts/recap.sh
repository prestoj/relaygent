#!/bin/bash
# relaygent recap — aggregate stats across recent sessions
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
load_config

DAYS=7
while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--days) DAYS="$2"; shift 2 ;;
        --json) JSON=1; shift ;;
        -h|--help) echo "Usage: relaygent recap [-d DAYS] [--json]"; echo "  Aggregate stats across recent sessions (default: 7 days)"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

URL="${HUB_SCHEME}://127.0.0.1:${HUB_PORT}/api/sessions?limit=500"
RESPONSE=$(curl -sf $CURL_K --max-time 10 "$URL" 2>/dev/null) || {
    echo -e "\033[1;33mHub not reachable on :${HUB_PORT}\033[0m — is it running?" >&2
    exit 1
}

python3 - "$RESPONSE" "$DAYS" "${JSON:-0}" <<'PYEOF'
import json, sys
from datetime import datetime, timedelta

data = json.loads(sys.argv[1])
days = int(sys.argv[2])
as_json = sys.argv[3] == "1"
sessions = data.get("sessions", [])

cutoff = datetime.now() - timedelta(days=days)
recent = []
for s in sessions:
    try:
        t = datetime.strptime(s["time"], "%Y-%m-%d %H:%M")
        if t >= cutoff:
            recent.append(s)
    except (ValueError, KeyError):
        continue

if not recent:
    if as_json:
        print(json.dumps({"days": days, "sessions": 0}))
    else:
        print(f"No sessions in the last {days} day(s).")
    sys.exit(0)

total_min = sum(s.get("durationMin", 0) for s in recent)
total_tokens = sum(s.get("tokens", 0) for s in recent)
total_tools = sum(s.get("tools", 0) for s in recent)
total_commits = sum(s.get("gitCommits", 0) for s in recent)
prs_created = []
prs_merged = []
for s in recent:
    prs_created.extend(s.get("prsCreated") or [])
    prs_merged.extend(s.get("prsMerged") or [])

# Top tools from summaries (rough heuristic from tool counts per session)
hours = total_min / 60
token_str = f"{total_tokens / 1_000_000:.1f}M" if total_tokens >= 1_000_000 else f"{total_tokens // 1000}K"

result = {
    "days": days, "sessions": len(recent),
    "hours": round(hours, 1), "tokens": total_tokens, "toolCalls": total_tools,
    "gitCommits": total_commits, "prsCreated": len(prs_created), "prsMerged": len(prs_merged),
    "prTitles": prs_created[:20],
}

if as_json:
    print(json.dumps(result, indent=2))
    sys.exit(0)

C = "\033[0;36m"; G = "\033[0;32m"; Y = "\033[1;33m"
B = "\033[1m"; D = "\033[2m"; N = "\033[0m"

print(f"\n{C}━━━ Recap: last {days} day(s) ━━━{N}\n")
print(f"  {B}Sessions:{N}  {len(recent)}")
print(f"  {B}Duration:{N}  {hours:.1f} hours")
print(f"  {B}Tokens:{N}    {token_str}")
print(f"  {B}Tools:{N}     {total_tools:,} calls")
print(f"  {B}Commits:{N}   {total_commits}")
print(f"  {B}PRs:{N}       {len(prs_created)} created, {len(prs_merged)} merged")

if prs_created:
    print(f"\n{C}PRs created:{N}")
    for title in prs_created[:15]:
        print(f"  {D}• {title}{N}")
    if len(prs_created) > 15:
        print(f"  {D}  ...and {len(prs_created) - 15} more{N}")

print()
PYEOF

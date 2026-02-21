#!/bin/bash
# Integration checks for relaygent (sourced by check.sh)
# Requires: REPO_DIR, ck_ok, ck_warn, ck_fail from lib.sh

# --- Slack ---
SLACK_USER="$HOME/.relaygent/slack/token.json"
SLACK_APP="$HOME/.relaygent/slack/app-token"
if [ -f "$SLACK_USER" ] && [ -f "$SLACK_APP" ]; then
    SLACK_TOK=$(python3 -c "import json; print(json.load(open('$SLACK_USER'))['access_token'])" 2>/dev/null)
    SLACK_AUTH=$(curl -sf --max-time 3 -H "Authorization: Bearer $SLACK_TOK" "https://slack.com/api/auth.test" 2>/dev/null)
    if echo "$SLACK_AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('ok') else 1)" 2>/dev/null; then
        ck_ok "Slack" "authenticated + Socket Mode enabled"
    else ck_warn "Slack" "token file exists but auth failed — may be expired"; fi
    pgrep -f "slack-socket-listener" >/dev/null 2>&1 \
        && ck_ok "Slack socket" "listener running" \
        || ck_warn "Slack socket" "listener not running — run: relaygent start"
elif [ -f "$SLACK_USER" ]; then
    ck_warn "Slack" "user token OK but no app token — real-time DMs won't work"
else ck_warn "Slack" "not configured (optional — run ./setup.sh)"; fi

# --- Email ---
[ -d "$REPO_DIR/email/node_modules" ] || ck_warn "Email MCP" "deps missing — run: npm install --prefix $REPO_DIR/email"
[ -f "$HOME/.relaygent/gmail/credentials.json" ] || ck_warn "Gmail" "not configured (optional — run: node $REPO_DIR/email/setup-gmail.mjs)"

# --- GitHub CLI ---
if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null; then ck_ok "GitHub CLI" "authenticated"
    else ck_warn "GitHub CLI" "installed but not authenticated — run: gh auth login"; fi
else ck_warn "GitHub CLI" "not installed (optional — needed for GitHub notifications)"; fi

# --- Linear ---
LINEAR_KEY="$HOME/.relaygent/linear/api-key"
if [ -f "$LINEAR_KEY" ] && [ -s "$LINEAR_KEY" ]; then ck_ok "Linear" "API key configured"
else ck_warn "Linear" "no API key (optional — needed for issue tracking)"; fi

# --- CLAUDE.md ---
if [ -f "$REPO_DIR/CLAUDE.md" ]; then ck_ok "CLAUDE.md" "project instructions present"
else ck_warn "CLAUDE.md" "missing — run: ./setup.sh to generate"; fi

# --- MCP servers ---
if [ -f "$HOME/.claude.json" ]; then
    MCP_DATA=$(python3 -c "
import json,os
cfg = json.load(open(os.path.expanduser('~/.claude.json')))
for name, srv in cfg.get('mcpServers', {}).items():
    args = srv.get('args', [])
    entry = args[0] if args else ''
    ok = '1' if entry and os.path.isfile(entry) else '0'
    print(f'{ok} {name} {entry}')
" 2>/dev/null)
    MCP_OK=0; MCP_TOTAL=0; MCP_BAD=""
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        MCP_TOTAL=$((MCP_TOTAL + 1))
        if [ "${line:0:1}" = "1" ]; then MCP_OK=$((MCP_OK + 1))
        else MCP_BAD="${MCP_BAD} $(echo "$line" | awk '{print $2}')"; fi
    done <<< "$MCP_DATA"
    if [ "$MCP_TOTAL" -eq 0 ] 2>/dev/null; then
        ck_warn "MCP servers" "none configured — run: relaygent mcp add"
    elif [ "$MCP_OK" -eq "$MCP_TOTAL" ]; then
        ck_ok "MCP servers" "$MCP_OK/$MCP_TOTAL entry points valid"
    else
        ck_fail "MCP servers" "$MCP_OK/$MCP_TOTAL valid — broken:${MCP_BAD}"
    fi
else ck_warn "MCP config" "~/.claude.json not found — run: relaygent setup"; fi

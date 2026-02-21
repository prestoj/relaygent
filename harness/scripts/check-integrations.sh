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
    MCP_COUNT=$(python3 -c "import json; print(len(json.load(open('$HOME/.claude.json')).get('mcpServers',{})))" 2>/dev/null || echo 0)
    if [ "${MCP_COUNT:-0}" -gt 0 ] 2>/dev/null; then
        ck_ok "MCP servers" "$MCP_COUNT configured (verify: relaygent mcp test)"
    else ck_warn "MCP servers" "none configured — run: relaygent mcp add"; fi
else ck_warn "MCP config" "~/.claude.json not found — run: relaygent setup"; fi

#!/bin/bash
# Relaygent health check — diagnose configuration and services.
# Exit 0 = all critical checks passed (warnings OK), Exit 1 = failures.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Relaygent Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# --- Dependencies ---
if command -v node &>/dev/null; then
    NODE_VER=$(node --version 2>/dev/null)
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
    if [ "${NODE_MAJOR:-0}" -ge 20 ] 2>/dev/null; then ck_ok "Node.js" "$NODE_VER"
    else ck_warn "Node.js" "$NODE_VER (20+ required) — upgrade: https://nodejs.org"; fi
else ck_fail "Node.js" "not found — install from https://nodejs.org (20+)"; fi

if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version 2>/dev/null | awk '{print $2}')
    PY_MINOR=$(echo "$PY_VER" | awk -F. '{print $2}')
    if [ "${PY_MINOR:-0}" -ge 9 ] 2>/dev/null; then ck_ok "Python" "$PY_VER"
    else ck_warn "Python" "$PY_VER (3.9+ recommended)"; fi
else ck_warn "Python" "not found (needed for notifications)"; fi

if command -v git &>/dev/null; then ck_ok "git" "$(git --version 2>/dev/null)"
else ck_fail "git" "not found — required for KB and hooks"; fi

if command -v claude &>/dev/null; then
    ck_ok "Claude Code" "$(claude --version 2>/dev/null | head -1 | tr -d '\n')"
    if [ -d "$HOME/.claude" ]; then ck_ok "Auth" "credentials directory found"
    else ck_warn "Auth" "~/.claude not found — run: claude"; fi
else
    ck_fail "Claude Code" "not found — install: npm install -g @anthropic-ai/claude-code"
    ck_warn "Auth" "cannot check (Claude Code missing)"
fi

# --- Config ---
if [ ! -f "$CONFIG_FILE" ]; then
    ck_fail "Config" "missing ($CONFIG_FILE) — run: ./setup.sh"
    MISSING_CONFIG=1
else
    ck_ok "Config" "$CONFIG_FILE"
    MISSING_CONFIG=0
fi
HUB_PORT=8080; NOTIF_PORT=8083; HS_PORT=8097; KB_DIR="${RELAYGENT_KB_DIR:-}"
if [ "$MISSING_CONFIG" = "0" ]; then
    load_config_soft || ck_warn "Config" "failed to parse — re-run: ./setup.sh"
fi

# --- Services ---
echo ""
if curl -sf --max-time 2 "http://127.0.0.1:${HUB_PORT}/api/health" >/dev/null 2>&1; then
    ck_ok "Hub" "running on :$HUB_PORT"
else ck_fail "Hub" "not responding on :$HUB_PORT — run: relaygent start"; fi

BUILD_COMMIT_FILE="$REPO_DIR/data/hub-build-commit"
CURRENT_HEAD=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")
BUILT_HEAD=$(head -c 40 "$BUILD_COMMIT_FILE" 2>/dev/null || echo "")
if [ ! -d "$REPO_DIR/hub/build" ]; then
    ck_warn "Hub build" "no build dir — run: relaygent update"
elif [ -n "$CURRENT_HEAD" ] && [ "$CURRENT_HEAD" != "$BUILT_HEAD" ]; then
    ck_warn "Hub build" "stale (built $(echo "$BUILT_HEAD" | head -c 7), current $(echo "$CURRENT_HEAD" | head -c 7)) — run: relaygent update"
else ck_ok "Hub build" "current ($(echo "${CURRENT_HEAD:-?}" | head -c 7))"; fi

if curl -sf --max-time 2 "http://127.0.0.1:${NOTIF_PORT}/health" >/dev/null 2>&1; then
    ck_ok "Notifications" "running on :$NOTIF_PORT"
else ck_fail "Notifications" "not responding on :$NOTIF_PORT — run: relaygent start"; fi

CU_NAME="Hammerspoon"; [ "$(uname)" = "Linux" ] && CU_NAME="Computer-use"
if curl -sf --max-time 2 "http://127.0.0.1:${HS_PORT}/health" >/dev/null 2>&1; then
    ck_ok "$CU_NAME" "running on :$HS_PORT"
else ck_warn "$CU_NAME" "not responding on :$HS_PORT (optional — needed for computer-use)"; fi

# Relay process
RELAY_PID="$HOME/.relaygent/relay.pid"
if [ -f "$RELAY_PID" ] && kill -0 "$(cat "$RELAY_PID")" 2>/dev/null; then
    ck_ok "Relay" "running (pid $(cat "$RELAY_PID"))"
elif pgrep -f "relay\.py" >/dev/null 2>&1; then
    ck_ok "Relay" "running (managed)"
else ck_warn "Relay" "not running — start with: relaygent start"; fi

# --- Service installation ---
echo ""
if [ "$(uname)" = "Darwin" ]; then
    LA_DIR="$HOME/Library/LaunchAgents"
    if [ -f "$LA_DIR/com.relaygent.hub.plist" ]; then
        INSTALLED=$(ls "$LA_DIR"/com.relaygent.*.plist 2>/dev/null | wc -l | tr -d ' ')
        ck_ok "LaunchAgents" "$INSTALLED services installed"
    else ck_warn "LaunchAgents" "not installed — run: relaygent install-services"; fi
else
    SD_DIR="$HOME/.config/systemd/user"
    if [ -f "$SD_DIR/relaygent-hub.service" ]; then
        INSTALLED=$(ls "$SD_DIR"/relaygent-*.service 2>/dev/null | wc -l | tr -d ' ')
        ck_ok "Systemd units" "$INSTALLED services installed"
    else ck_warn "Systemd units" "not installed — run: relaygent install-services"; fi
fi

# --- Knowledge base ---
if [ -n "$KB_DIR" ] && [ -d "$KB_DIR" ]; then
    TOPIC_COUNT=$(find "$KB_DIR" -name "*.md" -not -path "*/contacts/*" 2>/dev/null | wc -l | tr -d ' ')
    ck_ok "KB" "$TOPIC_COUNT topics in $KB_DIR"
    for f in HANDOFF.md INTENT.md MEMORY.md tasks.md; do
        [ ! -f "$KB_DIR/$f" ] && ck_warn "KB/$f" "missing (run: ./setup.sh)"
    done
else ck_fail "KB" "directory not found at ${KB_DIR:-unknown} — run: ./setup.sh"; fi

# Python venv
NOTIF_VENV="$REPO_DIR/notifications/.venv"
if [ -d "$NOTIF_VENV" ] && [ -x "$NOTIF_VENV/bin/python3" ]; then
    ck_ok "Python venv" "notifications venv ready"
else ck_warn "Python venv" "notifications/.venv missing — run: ./setup.sh"; fi

# Git hooks
git -C "$REPO_DIR" config --get core.hooksPath 2>/dev/null | grep -q scripts \
    && ck_ok "Git hooks" "200-line pre-commit enabled" \
    || ck_warn "Git hooks" "not configured — run: git -C $REPO_DIR config core.hooksPath scripts"

# Updates
git -C "$REPO_DIR" fetch -q origin main 2>/dev/null || true
BEHIND=$(git -C "$REPO_DIR" rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
if [ "${BEHIND:-0}" -gt 0 ] 2>/dev/null; then
    ck_warn "Updates" "$BEHIND commit(s) behind — run: relaygent update"
else ck_ok "Updates" "up to date"; fi

# --- System health ---
echo ""
DISK_PCT=$(df -h ~ 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}')
DISK_USED=$(df -h ~ 2>/dev/null | awk 'NR==2{print $5}')
if [ "${DISK_PCT:-0}" -gt 90 ] 2>/dev/null; then
    ck_fail "Disk" "${DISK_USED} used — critically low, free space immediately"
elif [ "${DISK_PCT:-0}" -gt 80 ] 2>/dev/null; then
    ck_warn "Disk" "${DISK_USED} used — getting full"
else ck_ok "Disk" "${DISK_USED} used"; fi

# Log directory size
LOG_DIR="$REPO_DIR/logs"
if [ -d "$LOG_DIR" ]; then
    LOG_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | awk '{print $1}')
    LOG_BYTES=$(du -s "$LOG_DIR" 2>/dev/null | awk '{print $1}')
    if [ "${LOG_BYTES:-0}" -gt 1048576 ] 2>/dev/null; then
        ck_warn "Logs" "$LOG_SIZE — consider: relaygent clean-logs"
    else ck_ok "Logs" "$LOG_SIZE"; fi
fi

# --- Integrations ---
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

[ -d "$REPO_DIR/email/node_modules" ] || ck_warn "Email MCP" "deps missing — run: npm install --prefix $REPO_DIR/email"
[ -f "$HOME/.relaygent/gmail/credentials.json" ] || ck_warn "Gmail" "not configured (optional — run: node $REPO_DIR/email/setup-gmail.mjs)"

# GitHub CLI
if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null; then ck_ok "GitHub CLI" "authenticated"
    else ck_warn "GitHub CLI" "installed but not authenticated — run: gh auth login"; fi
else ck_warn "GitHub CLI" "not installed (optional — needed for GitHub notifications)"; fi

# Linear
LINEAR_KEY="$HOME/.relaygent/linear/api-key"
if [ -f "$LINEAR_KEY" ] && [ -s "$LINEAR_KEY" ]; then ck_ok "Linear" "API key configured"
else ck_warn "Linear" "no API key (optional — needed for issue tracking)"; fi

# CLAUDE.md
if [ -f "$REPO_DIR/CLAUDE.md" ]; then ck_ok "CLAUDE.md" "project instructions present"
else ck_warn "CLAUDE.md" "missing — run: ./setup.sh to generate"; fi

# --- Summary ---
echo ""
ck_summary
exit $?

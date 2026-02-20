#!/bin/bash
# Relaygent health check — diagnose configuration and services.
# Exit 0 = all critical checks passed (warnings OK), Exit 1 = failures.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
KB_DIR="${RELAYGENT_KB_DIR:-}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

ok()   { echo -e "  ✓ $1: ${GREEN}$2${NC}";   PASS=$((PASS+1)); }
warn() { echo -e "  ⚠ $1: ${YELLOW}$2${NC}"; WARN=$((WARN+1)); }
fail() { echo -e "  ✗ $1: ${RED}$2${NC}";    FAIL=$((FAIL+1)); }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Relaygent Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Node.js version
if command -v node &>/dev/null; then
    NODE_VER=$(node --version 2>/dev/null)
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
    if [ "${NODE_MAJOR:-0}" -ge 20 ] 2>/dev/null; then
        ok "Node.js" "$NODE_VER"
    else
        warn "Node.js" "$NODE_VER (20+ required) — upgrade: https://nodejs.org"
    fi
else
    fail "Node.js" "not found — install from https://nodejs.org (20+)"
fi

# git
if command -v git &>/dev/null; then
    ok "git" "$(git --version 2>/dev/null)"
else
    fail "git" "not found — required for KB and hooks (install: sudo apt install git)"
fi

# Claude Code + auth
if command -v claude &>/dev/null; then
    VER=$(claude --version 2>/dev/null | head -1 | tr -d '\n')
    ok "Claude Code" "$VER"
    if [ -d "$HOME/.claude" ]; then
        ok "Auth" "credentials directory found (~/.claude)"
    else
        warn "Auth" "~/.claude not found — run: claude"
    fi
else
    fail "Claude Code" "not found — install: npm install -g @anthropic-ai/claude-code"
    warn "Auth" "cannot check (Claude Code missing)"
fi

# Config
MISSING_CONFIG=0
if [ ! -f "$CONFIG_FILE" ]; then
    fail "Config" "missing ($CONFIG_FILE) — run: ./setup.sh"
    MISSING_CONFIG=1
else
    ok "Config" "$CONFIG_FILE"
fi

# Parse ports from config (with safe fallbacks)
HUB_PORT=8080; NOTIF_PORT=8083; HS_PORT=8097
if [ "$MISSING_CONFIG" = "0" ]; then
    HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
    NOTIF_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['notifications']['port'])" 2>/dev/null || echo 8083)
    HS_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('services',{}).get('hammerspoon',{}).get('port',8097))" 2>/dev/null || echo 8097)
    if [ -z "$KB_DIR" ]; then
        KB_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['kb'])" 2>/dev/null || echo "$REPO_DIR/knowledge/topics")
    fi
fi

# Services
echo ""
if curl -sf --max-time 2 "http://127.0.0.1:${HUB_PORT}/api/health" >/dev/null 2>&1; then
    ok "Hub" "running on :$HUB_PORT"
else
    fail "Hub" "not responding on :$HUB_PORT — run: relaygent start"
fi
BUILD_COMMIT_FILE="$REPO_DIR/data/hub-build-commit"
CURRENT_HEAD=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")
BUILT_HEAD=$(cat "$BUILD_COMMIT_FILE" 2>/dev/null | head -c 40 || echo "")
if [ ! -d "$REPO_DIR/hub/build" ]; then
    warn "Hub build" "no build dir — run: relaygent update"
elif [ -n "$CURRENT_HEAD" ] && [ "$CURRENT_HEAD" != "$BUILT_HEAD" ]; then
    warn "Hub build" "stale (built $(echo "$BUILT_HEAD" | head -c 7), current $(echo "$CURRENT_HEAD" | head -c 7)) — run: relaygent update"
else
    ok "Hub build" "current ($(echo "${CURRENT_HEAD:-?}" | head -c 7))"
fi
if curl -sf --max-time 2 "http://127.0.0.1:${NOTIF_PORT}/health" >/dev/null 2>&1; then
    ok "Notifications" "running on :$NOTIF_PORT"
else
    fail "Notifications" "not responding on :$NOTIF_PORT — run: relaygent start"
fi
CU_NAME="Hammerspoon"; [ "$(uname)" = "Linux" ] && CU_NAME="Computer-use"
if curl -sf --max-time 2 "http://127.0.0.1:${HS_PORT}/health" >/dev/null 2>&1; then
    ok "$CU_NAME" "running on :$HS_PORT"
else
    warn "$CU_NAME" "not responding on :$HS_PORT (optional — needed for computer-use)"
fi

# Relay process
RELAY_PID="$HOME/.relaygent/relay.pid"
if [ -f "$RELAY_PID" ] && kill -0 "$(cat "$RELAY_PID")" 2>/dev/null; then
    ok "Relay" "running (pid $(cat "$RELAY_PID"))"
else
    warn "Relay" "not running — start with: relaygent start"
fi

# Knowledge base
echo ""
if [ -n "$KB_DIR" ] && [ -d "$KB_DIR" ]; then
    TOPIC_COUNT=$(find "$KB_DIR" -name "*.md" -not -path "*/contacts/*" 2>/dev/null | wc -l | tr -d ' ')
    ok "KB" "$TOPIC_COUNT topics in $KB_DIR"
    for f in handoff.md intent.md memory.md tasks.md; do
        [ ! -f "$KB_DIR/$f" ] && warn "KB/$f" "missing (run: ./setup.sh)"
    done
else
    fail "KB" "directory not found at ${KB_DIR:-unknown} — run: ./setup.sh"
fi

# Python venv (notifications)
NOTIF_VENV="$REPO_DIR/notifications/.venv"
if [ -d "$NOTIF_VENV" ] && [ -x "$NOTIF_VENV/bin/python3" ]; then
    VENV_VER=$("$NOTIF_VENV/bin/python3" --version 2>/dev/null | awk '{print $2}')
    ok "Python venv" "notifications venv ready ($VENV_VER)"
else
    warn "Python venv" "notifications/.venv missing — run: ./setup.sh"
fi

# Git hooks
if git -C "$REPO_DIR" config --get core.hooksPath 2>/dev/null | grep -q scripts; then
    ok "Git hooks" "200-line pre-commit enabled"
else
    warn "Git hooks" "not configured — run: git -C $REPO_DIR config core.hooksPath scripts"
fi

# Available updates
git -C "$REPO_DIR" fetch -q origin main 2>/dev/null || true
BEHIND=$(git -C "$REPO_DIR" rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
if [ "${BEHIND:-0}" -gt 0 ] 2>/dev/null; then
    warn "Updates" "$BEHIND commit(s) available — run: relaygent update"
else
    ok "Updates" "up to date"
fi

# Disk space
echo ""
DISK_PCT=$(df -h ~ 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}')
DISK_USED=$(df -h ~ 2>/dev/null | awk 'NR==2{print $5}')
if [ "${DISK_PCT:-0}" -gt 90 ] 2>/dev/null; then
    fail "Disk" "${DISK_USED} used — critically low, free space immediately"
elif [ "${DISK_PCT:-0}" -gt 80 ] 2>/dev/null; then
    warn "Disk" "${DISK_USED} used — getting full"
else
    ok "Disk" "${DISK_USED} used"
fi

# Slack
SLACK_USER="$HOME/.relaygent/slack/token.json"
SLACK_APP="$HOME/.relaygent/slack/app-token"
if [ -f "$SLACK_USER" ] && [ -f "$SLACK_APP" ]; then
    SLACK_TOK=$(python3 -c "import json; print(json.load(open('$SLACK_USER'))['access_token'])" 2>/dev/null)
    SLACK_AUTH=$(curl -sf --max-time 3 -H "Authorization: Bearer $SLACK_TOK" "https://slack.com/api/auth.test" 2>/dev/null)
    if echo "$SLACK_AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('ok') else 1)" 2>/dev/null; then
        ok "Slack" "user token valid + app token (Socket Mode enabled)"
    else
        warn "Slack" "token file exists but auth.test failed — token may be expired"
    fi
    if pgrep -f "slack-socket-listener" >/dev/null 2>&1; then
        ok "Slack socket" "listener running (real-time DMs active)"
    else
        warn "Slack socket" "listener not running — run: relaygent start"
    fi
elif [ -f "$SLACK_USER" ]; then
    warn "Slack" "user token OK but no app token — real-time DMs won't work (add xapp-* token to $SLACK_APP)"
elif [ -f "$SLACK_APP" ]; then
    warn "Slack" "only app token — messages sent as bot, not as user"
else
    warn "Slack" "not configured (optional — run ./setup.sh to configure)"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}$FAIL failed, $WARN warnings, $PASS passed.${NC}"
    echo -e "  ${RED}Fix failures above before running: relaygent start${NC}"
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo -e "  ${YELLOW}$WARN warnings, $PASS passed. System usable but review warnings.${NC}"
else
    echo -e "  ${GREEN}All $PASS checks passed.${NC}"
fi

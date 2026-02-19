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
if [ ! -d "$REPO_DIR/hub/build" ]; then
    warn "Hub build" "no build dir — hub may be in dev mode or needs rebuild"
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
    for f in handoff.md intent.md working-state.md; do
        [ ! -f "$KB_DIR/$f" ] && warn "KB/$f" "missing (run: ./setup.sh)"
    done
else
    fail "KB" "directory not found at ${KB_DIR:-unknown} — run: ./setup.sh"
fi

# Git hooks
if git -C "$REPO_DIR" config --get core.hooksPath 2>/dev/null | grep -q scripts; then
    ok "Git hooks" "200-line pre-commit enabled"
else
    warn "Git hooks" "not configured — run: git -C $REPO_DIR config core.hooksPath scripts"
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
if [ -f "$HOME/.relaygent/slack/token.json" ]; then
    ok "Slack" "user token configured"
elif [ -f "$HOME/.relaygent/slack/app-token" ]; then
    warn "Slack" "only app token (messages sent as bot, not as user)"
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

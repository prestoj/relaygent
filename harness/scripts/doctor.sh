#!/bin/bash
# Relaygent doctor — auto-fix common issues found by `relaygent check`.
# Usage: relaygent doctor [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

DRY_RUN=0; [[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
FIXED=0; SKIPPED=0

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Relaygent Doctor"
[[ "$DRY_RUN" == 1 ]] && echo "  (dry run — no changes will be made)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

fix_msg() { echo -e "  ${GREEN}✓ Fixed:${NC} $1"; FIXED=$((FIXED+1)); }
skip_msg() { echo -e "  ${YELLOW}⚠ Skipped:${NC} $1"; SKIPPED=$((SKIPPED+1)); }
ok_msg() { echo -e "  ✓ $1"; }
dry_msg() { echo -e "  ${CYAN}Would fix:${NC} $1"; FIXED=$((FIXED+1)); }
do_fix() { [[ "$DRY_RUN" == 1 ]] && dry_msg "$1" || { eval "$2" && fix_msg "$1" || skip_msg "$1 (command failed)"; }; }

# Load config (soft — may not exist yet)
HUB_PORT=8080; NOTIF_PORT=8083; HS_PORT=8097; KB_DIR=""; DATA_DIR="$REPO_DIR/data"
load_config_soft 2>/dev/null || true

# --- 1. Git hooks ---
echo -e "\n${CYAN}Git hooks:${NC}"
HOOKS_PATH=$(git -C "$REPO_DIR" config --get core.hooksPath 2>/dev/null || echo "")
if [[ "$HOOKS_PATH" != *scripts* ]]; then
    do_fix "Set git hooks to scripts/" "git -C '$REPO_DIR' config core.hooksPath scripts"
else
    ok_msg "Git hooks configured"
fi

# --- 2. Python venv ---
echo -e "\n${CYAN}Python venv:${NC}"
NOTIF_VENV="$REPO_DIR/notifications/.venv"
if [[ ! -d "$NOTIF_VENV" ]] || [[ ! -x "$NOTIF_VENV/bin/python3" ]]; then
    if command -v python3 &>/dev/null; then
        do_fix "Create notifications venv + install deps" \
            "python3 -m venv '$NOTIF_VENV' && '$NOTIF_VENV/bin/pip' install -q -r '$REPO_DIR/notifications/requirements.txt'"
    else
        skip_msg "Python3 not found — install it first"
    fi
else
    ok_msg "Notifications venv ready"
fi

# --- 3. Missing KB files ---
echo -e "\n${CYAN}Knowledge base:${NC}"
if [[ -n "$KB_DIR" ]] && [[ -d "$KB_DIR" ]]; then
    TEMPLATES="$REPO_DIR/templates"
    KB_FIXED=0
    for f in HANDOFF.md INTENT.md MEMORY.md tasks.md projects.md curiosities.md; do
        if [[ ! -f "$KB_DIR/$f" ]] && [[ -f "$TEMPLATES/$f" ]]; then
            do_fix "Create KB/$f from template" "cp '$TEMPLATES/$f' '$KB_DIR/$f'"
            KB_FIXED=1
        fi
    done
    [[ "$KB_FIXED" == 0 ]] && ok_msg "All KB files present"
elif [[ -z "$KB_DIR" ]]; then
    skip_msg "KB directory not configured — run: relaygent setup"
else
    skip_msg "KB directory $KB_DIR doesn't exist — run: relaygent setup"
fi

# --- 4. Hub build ---
echo -e "\n${CYAN}Hub build:${NC}"
BUILD_COMMIT_FILE="$DATA_DIR/hub-build-commit"
CURRENT_HEAD=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")
BUILT_HEAD=$(head -c 40 "$BUILD_COMMIT_FILE" 2>/dev/null || echo "")
if [[ ! -d "$REPO_DIR/hub/build" ]]; then
    do_fix "Build hub from scratch" "bash '$REPO_DIR/scripts/hub-rebuild-if-stale.sh' --force"
elif [[ -n "$CURRENT_HEAD" ]] && [[ "$CURRENT_HEAD" != "$BUILT_HEAD" ]]; then
    do_fix "Rebuild stale hub" "bash '$REPO_DIR/scripts/hub-rebuild-if-stale.sh' --force"
else
    ok_msg "Hub build current ($(echo "${CURRENT_HEAD:-?}" | head -c 7))"
fi

# --- 5. Large logs ---
echo -e "\n${CYAN}Logs:${NC}"
LOG_DIR="$REPO_DIR/logs"
if [[ -d "$LOG_DIR" ]]; then
    LOG_BYTES=$(du -s "$LOG_DIR" 2>/dev/null | awk '{print $1}')
    if [[ "${LOG_BYTES:-0}" -gt 1048576 ]] 2>/dev/null; then
        LOG_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | awk '{print $1}')
        do_fix "Clean large logs ($LOG_SIZE)" "bash '$SCRIPT_DIR/clean-logs.sh' --days 3"
    else
        ok_msg "Logs within limits"
    fi
fi

# --- 6. Service installation ---
echo -e "\n${CYAN}Service installation:${NC}"
if [[ "$(uname)" == "Darwin" ]]; then
    LA_DIR="$HOME/Library/LaunchAgents"
    if [[ ! -f "$LA_DIR/com.relaygent.hub.plist" ]]; then
        do_fix "Install LaunchAgents" "bash '$REPO_DIR/scripts/install-launchagents.sh'"
    else
        ok_msg "LaunchAgents installed"
    fi
else
    SD_DIR="$HOME/.config/systemd/user"
    if [[ ! -f "$SD_DIR/relaygent-hub.service" ]]; then
        do_fix "Install systemd services" "bash '$REPO_DIR/scripts/install-systemd-services.sh'"
    else
        ok_msg "Systemd services installed"
    fi
fi

# --- 7. Node modules ---
echo -e "\n${CYAN}Node modules:${NC}"
if [[ ! -d "$REPO_DIR/hub/node_modules" ]]; then
    do_fix "Install hub node_modules" "cd '$REPO_DIR/hub' && npm install --silent 2>/dev/null"
else
    ok_msg "Hub node_modules installed"
fi

# --- 8. Service health ---
echo -e "\n${CYAN}Service health:${NC}"
_check_svc() {
    local name=$1 port=$2 svc_name=$3
    local path=${4:-/health}
    if curl -sf --max-time 2 "http://127.0.0.1:$port$path" >/dev/null 2>&1; then
        ok_msg "$name responding on :$port"
    elif [[ "$(uname)" == "Darwin" ]]; then
        local plist="com.relaygent.${svc_name}.plist"
        if [[ -f "$HOME/Library/LaunchAgents/$plist" ]]; then
            do_fix "Restart $name (LaunchAgent)" \
                "launchctl kickstart -k 'gui/$(id -u)/com.relaygent.$svc_name' 2>/dev/null || launchctl stop 'com.relaygent.$svc_name' 2>/dev/null; sleep 1; launchctl start 'com.relaygent.$svc_name' 2>/dev/null"
        else
            skip_msg "$name not responding and no LaunchAgent found"
        fi
    else
        local unit="relaygent-${svc_name}.service"
        if systemctl --user is-enabled "$unit" &>/dev/null; then
            do_fix "Restart $name (systemd)" "systemctl --user restart '$unit'"
        else
            skip_msg "$name not responding and no systemd service found"
        fi
    fi
}
_check_svc "Hub" "$HUB_PORT" "hub" "/api/health"
_check_svc "Notifications" "$NOTIF_PORT" "notifications"

# --- 9. Hammerspoon Lua files ---
if [[ "$(uname)" == "Darwin" ]] && [[ -d "$HOME/.hammerspoon" ]]; then
    echo -e "\n${CYAN}Hammerspoon config:${NC}"
    _HS_OK=1
    for f in init.lua input_handlers.lua ax_handler.lua ax_press.lua held_input.lua window_manage.lua; do
        if [[ ! -f "$HOME/.hammerspoon/$f" ]] && [[ -f "$REPO_DIR/hammerspoon/$f" ]]; then
            do_fix "Copy $f to ~/.hammerspoon/" "cp '$REPO_DIR/hammerspoon/$f' '$HOME/.hammerspoon/$f'"
            _HS_OK=0
        fi
    done
    [[ "$_HS_OK" == 1 ]] && ok_msg "All Lua files present"
fi

# --- 10. macOS typing ---
if [[ "$(uname)" == "Darwin" ]]; then
    echo -e "\n${CYAN}macOS typing:${NC}"
    _TYPING_OK=1
    for key in NSAutocorrect NSAutomaticSpellingCorrectionEnabled NSAutomaticCapitalizationEnabled NSAutomaticPeriodSubstitutionEnabled NSAutomaticTextCompletionEnabled; do
        val=$(defaults read NSGlobalDomain "$key" 2>/dev/null || echo "")
        if [[ "$val" != "0" ]]; then
            do_fix "Disable $key" "defaults write NSGlobalDomain $key -bool false"
            _TYPING_OK=0
        fi
    done
    [[ "$_TYPING_OK" == 1 ]] && ok_msg "Autocorrect/autocapitalize disabled"
fi

# --- 11. Updates ---
echo -e "\n${CYAN}Updates:${NC}"
git -C "$REPO_DIR" fetch -q origin main 2>/dev/null || true
BEHIND=$(git -C "$REPO_DIR" rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
if [[ "${BEHIND:-0}" -gt 0 ]] 2>/dev/null; then
    do_fix "Pull $BEHIND commit(s) from origin/main" \
        "git -C '$REPO_DIR' pull --ff-only origin main 2>/dev/null"
else
    ok_msg "Up to date with origin/main"
fi

# --- Summary ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$FIXED" -gt 0 ]] && [[ "$DRY_RUN" == 1 ]]; then
    echo -e "  ${CYAN}$FIXED issue(s) would be fixed. Run without --dry-run to apply.${NC}"
elif [[ "$FIXED" -gt 0 ]]; then
    echo -e "  ${GREEN}$FIXED issue(s) fixed.${NC}"
    [[ "$SKIPPED" -gt 0 ]] && echo -e "  ${YELLOW}$SKIPPED issue(s) need manual attention.${NC}"
elif [[ "$SKIPPED" -gt 0 ]]; then
    echo -e "  ${YELLOW}$SKIPPED issue(s) need manual attention.${NC}"
else
    echo -e "  ${GREEN}Everything looks healthy!${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

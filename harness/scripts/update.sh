#!/bin/bash
# Relaygent update — pull latest code, rebuild hub, and restart it
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

echo -e "${CYAN}Updating Relaygent...${NC}"

# In Docker, .git is excluded — skip git operations, just rebuild + restart
STASHED=false; BEFORE=""; AFTER=""
if is_docker 2>/dev/null || [ ! -d "$REPO_DIR/.git" ]; then
    echo -e "  ${YELLOW}Docker/no-git mode — skipping pull, rebuilding hub${NC}"
else
    # Stash tracked changes to avoid losing work
    if git -C "$REPO_DIR" diff --quiet 2>/dev/null && git -C "$REPO_DIR" diff --cached --quiet 2>/dev/null; then
        : # No tracked modifications
    elif [ -n "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]; then
        git -C "$REPO_DIR" stash push -m "relaygent-update-$(date +%s)" -q 2>/dev/null && STASHED=true
        [ "$STASHED" = true ] && echo -e "  ${YELLOW}Stashed uncommitted changes${NC}"
    fi
    ORIG_BRANCH=$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo "")
    if [ -n "$ORIG_BRANCH" ] && [ "$ORIG_BRANCH" != "main" ]; then
        echo -e "  ${YELLOW}Switching from $ORIG_BRANCH to main${NC}"
        git -C "$REPO_DIR" checkout main -q 2>/dev/null || true
    fi
    BEFORE=$(git -C "$REPO_DIR" rev-parse HEAD)
    if ! git -C "$REPO_DIR" pull --ff-only 2>/dev/null; then
        echo -e "  ${YELLOW}Local diverged from origin/main — resetting${NC}"
        git -C "$REPO_DIR" fetch origin main
        git -C "$REPO_DIR" reset --hard origin/main
    fi
    AFTER=$(git -C "$REPO_DIR" rev-parse HEAD)
    if [ "$BEFORE" = "$AFTER" ]; then
        echo -e "  ${YELLOW}Already up to date (rebuilding hub anyway)${NC}"
    else
        echo -e "  ${GREEN}Updated:${NC}"
        git -C "$REPO_DIR" log --oneline "${BEFORE}..${AFTER}" | while IFS= read -r line; do echo "    $line"; done
    fi
fi

# Install deps for all services (fast no-op when already up to date)
for svc in hub notifications computer-use email slack secrets; do
    [ -f "$REPO_DIR/$svc/package.json" ] && npm install -q --prefix "$REPO_DIR/$svc" 2>/dev/null
done
# Update Python venv if requirements changed
NOTIF_VENV="$REPO_DIR/notifications/.venv"
if [ -d "$NOTIF_VENV" ] && [ -f "$REPO_DIR/notifications/requirements.txt" ]; then
    "$NOTIF_VENV/bin/pip" install -q -r "$REPO_DIR/notifications/requirements.txt" 2>/dev/null || true
fi

# Sync Hammerspoon config (macOS computer-use)
if [ "$(uname)" = "Darwin" ] && [ -d "$HOME/.hammerspoon" ] && [ -d "$REPO_DIR/hammerspoon" ]; then
    cp "$REPO_DIR"/hammerspoon/*.lua "$HOME/.hammerspoon/" 2>/dev/null || true
    HS_PORT="${HAMMERSPOON_PORT:-8097}"
    curl -sf --max-time 2 "http://localhost:$HS_PORT/reload" -X POST >/dev/null 2>&1 && echo -e "  Hammerspoon: ${GREEN}config reloaded${NC}" || true
fi

# Rebuild hub
echo -e "  Rebuilding hub..."
if (cd "$REPO_DIR/hub" && npx vite build >/dev/null 2>&1); then
    echo -e "  Hub: ${GREEN}built${NC}"
    git -C "$REPO_DIR" rev-parse HEAD > "$DATA_DIR/hub-build-commit" 2>/dev/null || true
else
    echo -e "  Hub: ${RED}build failed — check logs${NC}"
    exit 1
fi

load_config

# Restart services — skip platform refresh in Docker
LAUNCHAGENTS_REFRESHED=false
if is_docker 2>/dev/null; then
    : # Docker — fall through to manual restart path below
elif [ "$(uname)" = "Darwin" ] && ls "$HOME/Library/LaunchAgents/com.relaygent."*.plist &>/dev/null 2>&1; then
    echo -e "  Refreshing LaunchAgents (picks up plist/env changes)..."
    bash "$REPO_DIR/scripts/install-launchagents.sh"
    LAUNCHAGENTS_REFRESHED=true
fi

if [ "$LAUNCHAGENTS_REFRESHED" = false ]; then
    source "$REPO_DIR/harness/scripts/restart-daemons.sh"
fi

# Check if MCP server source files changed (agents need to restart their session)
MCP_CHANGED=false
if [ -n "$BEFORE" ] && [ -n "$AFTER" ] && [ "$BEFORE" != "$AFTER" ]; then
    if git -C "$REPO_DIR" diff --name-only "${BEFORE}..${AFTER}" | grep -qE 'computer-use/.*\.mjs$'; then
        MCP_CHANGED=true
    fi
fi
if [ "$MCP_CHANGED" = true ]; then
    echo -e "\n  ${YELLOW}NOTE: MCP server source files changed. MCP servers cache code at"
    echo -e "  session start — restart your Claude Code session to pick up changes.${NC}"
fi

# Clean up old logs
bash "$REPO_DIR/harness/scripts/clean-logs.sh" 2>/dev/null || true

# Return to original branch if we switched away
if [ -n "${ORIG_BRANCH:-}" ] && [ "$ORIG_BRANCH" != "main" ]; then
    git -C "$REPO_DIR" checkout "$ORIG_BRANCH" -q 2>/dev/null && echo -e "  Restored branch: ${GREEN}$ORIG_BRANCH${NC}" || true
fi

# Restore stashed changes if we stashed earlier
if [ "$STASHED" = true ]; then
    if git -C "$REPO_DIR" stash pop -q 2>/dev/null; then
        echo -e "  ${GREEN}Restored stashed changes${NC}"
    else
        # Drop the conflicting stash to prevent recurring conflicts in future updates
        git -C "$REPO_DIR" checkout -- . 2>/dev/null || true
        git -C "$REPO_DIR" stash drop -q 2>/dev/null || true
        echo -e "  ${YELLOW}Stash conflicted with new code — dropped (changes were pre-update)${NC}"
    fi
fi

# Post-update health verification
echo -e "\n  Verifying services..."
sleep 3
UPDATE_HEALTHY=true
for svc_check in "Hub:$HUB_PORT:/api/health" "Notifications:$NOTIF_PORT:/health"; do
    IFS=: read -r svc_name svc_port svc_path <<< "$svc_check"
    local_scheme="http"; [[ "$svc_port" = "$HUB_PORT" ]] && local_scheme="${HUB_SCHEME:-http}"
    if curl -sf $CURL_K --max-time 3 "${local_scheme}://127.0.0.1:${svc_port}${svc_path}" >/dev/null 2>&1; then
        echo -e "  $svc_name: ${GREEN}healthy${NC}"
    else
        echo -e "  $svc_name: ${RED}not responding — run: relaygent health${NC}"
        UPDATE_HEALTHY=false
    fi
done
if [ "$UPDATE_HEALTHY" = true ]; then
    echo -e "\n  ${GREEN}Update complete — all services healthy.${NC}"
else
    echo -e "\n  ${YELLOW}Update complete — some services may still be starting.${NC}"
    echo -e "  ${YELLOW}Run 'relaygent health' to check, or 'relaygent doctor' to fix.${NC}"
fi

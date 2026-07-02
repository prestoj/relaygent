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

# Update Claude Code CLI (fast no-op when already latest)
if command -v npm >/dev/null 2>&1; then
    PREV_VER=$(claude --version 2>/dev/null | awk '{print $1}' || echo "unknown")
    # Registry latest, so we can VERIFY the install actually landed (not just trust the exit
    # code — --quiet + 2>/dev/null hide failures). Empty on network hiccup → we skip the
    # latest-comparison and fall back to "did the version change" reporting.
    LATEST_VER=$(npm view @anthropic-ai/claude-code version 2>/dev/null || echo "")
    # Take the fast-path ONLY when the version is latest AND `claude` resolves under the live npm
    # prefix. If a node bump left `claude` latest-but-symlinked-into-an-old-keg (claude_off_prefix),
    # fall through to the install branch so npm reinstalls latest INTO the live prefix — otherwise
    # there's no live-prefix binary to repoint to and the old keg stays doomed (#774 review catch).
    if [ -n "$LATEST_VER" ] && [ "$PREV_VER" = "$LATEST_VER" ] && ! claude_off_prefix; then
        echo -e "  Claude Code: ${GREEN}$PREV_VER (latest)${NC}"
    else
        # Pick sudo up front if the global module dir isn't writable (Linux system npm).
        NPM_MODULES="$(npm prefix -g 2>/dev/null)/lib/node_modules"
        NPM_CMD="npm"
        if [ ! -w "$NPM_MODULES" ] && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
            NPM_CMD="sudo npm"
        fi
        # Capture npm's stderr so the FAILED-to-reach branch can show WHY (EACCES / network /
        # disk) instead of just "check npm perms" — saves a manual re-run during an incident.
        NPM_ERR=$(mktemp 2>/dev/null || echo "/tmp/relaygent-npm-err.$$")
        $NPM_CMD install -g @anthropic-ai/claude-code@latest --quiet 2>"$NPM_ERR" || true
        NEW_VER=$(claude --version 2>/dev/null | awk '{print $1}' || echo "unknown")
        # Sudo fallback: even when the global dir TESTS writable, a plain `npm install -g`
        # can EACCES on macOS (npm renames the running binary's package dir; #762's
        # writability check misses this) — leaving the Mac silently stuck on a stale CLI.
        # If the version didn't reach latest and we haven't tried sudo yet, retry with sudo.
        if [ -n "$LATEST_VER" ] && [ "$NEW_VER" != "$LATEST_VER" ] && [ "$NPM_CMD" = "npm" ] \
           && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
            sudo npm install -g @anthropic-ai/claude-code@latest --quiet 2>"$NPM_ERR" || true
            NEW_VER=$(claude --version 2>/dev/null | awk '{print $1}' || echo "unknown")
        fi
        # Durable symlink repoint (node-bump fallout): a node bump moves npm's global prefix, so the
        # install lands `latest` in the NEW prefix while PATH `claude` still points at the OLD
        # prefix's stale binary (npm reports success but `claude --version` never moves) — or claude
        # is current but symlinked into an old keg a cleanup will delete. repoint_claude_symlink
        # (lib.sh) fixes both by repointing the owned symlink at the live keg's npm shim.
        if repoint_claude_symlink "$LATEST_VER"; then
            NEW_VER=$(claude --version 2>/dev/null | awk '{print $1}' || echo "$NEW_VER")
        fi
        if [ "$PREV_VER" != "$NEW_VER" ]; then
            echo -e "  Claude Code: ${GREEN}$PREV_VER → $NEW_VER${NC}"
        elif [ -n "$LATEST_VER" ] && [ "$NEW_VER" != "$LATEST_VER" ]; then
            echo -e "  Claude Code: ${YELLOW}$NEW_VER — FAILED to reach $LATEST_VER (check npm perms)${NC}"
            [ -s "$NPM_ERR" ] && tail -3 "$NPM_ERR" | sed 's/^/    npm: /'
        else
            echo -e "  Claude Code: ${GREEN}$NEW_VER (latest)${NC}"
        fi
        rm -f "$NPM_ERR"
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
    # Resolve DATA_DIR from config paths.data the SAME way the reader does
    # (hub-rebuild-if-stale.sh:21) — load_config runs below this block, so
    # DATA_DIR isn't set yet, and $REPO_DIR/data is wrong on boxes where
    # paths.data differs from the repo dir (writer/reader would diverge).
    DATA_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['paths']['data'])" 2>/dev/null || echo "$REPO_DIR/data")
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

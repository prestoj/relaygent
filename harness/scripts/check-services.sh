#!/bin/bash
# Service checks for relaygent (sourced by check.sh)
# Requires: HUB_SCHEME, CURL_K, HUB_PORT, NOTIF_PORT, HS_PORT, DATA_DIR, REPO_DIR
# Requires: ck_ok, ck_warn, ck_fail from check-lib.sh

if curl -sf $CURL_K --max-time 2 "${HUB_SCHEME}://127.0.0.1:${HUB_PORT}/api/health" >/dev/null 2>&1; then
    ck_ok "Hub" "running on :$HUB_PORT"
else ck_fail "Hub" "not responding on :$HUB_PORT — run: relaygent start"; fi

BUILD_COMMIT_FILE="$DATA_DIR/hub-build-commit"
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
else
    if [ "$(uname)" = "Darwin" ]; then
        if [ ! -d "/Applications/Hammerspoon.app" ] && [ ! -d "$HOME/Applications/Hammerspoon.app" ]; then
            ck_warn "$CU_NAME" "not installed — run: brew install --cask hammerspoon"
        elif ! pgrep -q Hammerspoon 2>/dev/null; then
            ck_warn "$CU_NAME" "installed but not running — run: open -a Hammerspoon"
        else
            ck_warn "$CU_NAME" "running but API not responding on :$HS_PORT — check config or reload"
        fi
    else
        for cmd in xdotool scrot wmctrl; do
            command -v "$cmd" &>/dev/null || ck_warn "$CU_NAME" "$cmd not found — run: apt install $cmd"
        done
        if ! pgrep -f "linux-server.py" >/dev/null 2>&1; then
            ck_warn "$CU_NAME" "server not running on :$HS_PORT — run: relaygent start"
        else
            ck_warn "$CU_NAME" "running but not responding on :$HS_PORT"
        fi
    fi
fi

# Chrome CDP (needed for browser_* tools)
if curl -sf --max-time 2 "http://127.0.0.1:9223/json/version" >/dev/null 2>&1; then
    ck_ok "Chrome CDP" "available on :9223"
else ck_warn "Chrome CDP" "not available on :9223 (optional — needed for browser tools)"; fi

# Relay process
RELAY_PID="$HOME/.relaygent/relay.pid"
if [ -f "$RELAY_PID" ] && kill -0 "$(cat "$RELAY_PID")" 2>/dev/null; then
    ck_ok "Relay" "running (pid $(cat "$RELAY_PID"))"
elif pgrep -f "relay\.py" >/dev/null 2>&1; then
    ck_ok "Relay" "running (managed)"
else ck_warn "Relay" "not running — start with: relaygent start"; fi

#!/bin/bash
# Rebuild the hub if the running build is behind HEAD.
# Safe to run any time — no-ops if already up to date.
#
# Usage:
#   scripts/hub-rebuild-if-stale.sh           # from repo root
#   scripts/hub-rebuild-if-stale.sh --force   # rebuild regardless
#
# Launchd: run as a periodic job (e.g. every 5 min) to keep hub current.
# The hub goes down for ~30s during rebuild.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_COMMIT="$REPO_DIR/data/hub-build-commit"
LOG="$REPO_DIR/logs/hub-autobuild.log"
FORCE="${1:-}"

HEAD=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
BUILT=$(cat "$BUILD_COMMIT" 2>/dev/null || echo "")

if [ "$FORCE" != "--force" ] && [ "$HEAD" = "$BUILT" ]; then
    exit 0  # Already up to date
fi

mkdir -p "$(dirname "$LOG")"

# Pull latest commits before building
git -C "$REPO_DIR" pull --ff-only origin main >> "$LOG" 2>&1 || true
HEAD=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")

# Re-check after pull — may already be up to date
BUILT=$(cat "$BUILD_COMMIT" 2>/dev/null || echo "")
if [ "$FORCE" != "--force" ] && [ "$HEAD" = "$BUILT" ]; then
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding hub (was: ${BUILT:0:8}, now: ${HEAD:0:8})" | tee -a "$LOG"

# Use bootout/bootstrap (not stop/start) — KeepAlive:true means stop immediately restarts
HUB_PLIST="$HOME/Library/LaunchAgents/com.relaygent.hub.plist"
GUID="gui/$(id -u)"
launchctl bootout "$GUID" "$HUB_PLIST" 2>/dev/null || true
sleep 1  # Give the process time to exit cleanly

if npm run build --prefix "$REPO_DIR/hub" >> "$LOG" 2>&1; then
    echo "$HEAD" > "$BUILD_COMMIT"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuild complete." | tee -a "$LOG"
    launchctl bootstrap "$GUID" "$HUB_PLIST"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuild FAILED — restarting with old build." | tee -a "$LOG"
    launchctl bootstrap "$GUID" "$HUB_PLIST"
    exit 1
fi

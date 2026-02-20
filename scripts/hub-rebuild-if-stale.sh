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
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding hub (was: ${BUILT:0:8}, now: ${HEAD:0:8})" | tee -a "$LOG"

launchctl stop com.relaygent.hub 2>/dev/null || true
if npm run build --prefix "$REPO_DIR/hub" >> "$LOG" 2>&1; then
    launchctl start com.relaygent.hub
    echo "$HEAD" > "$BUILD_COMMIT"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuild complete." | tee -a "$LOG"
else
    launchctl start com.relaygent.hub  # restart with old build on failure
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuild FAILED — restarted with old build." | tee -a "$LOG"
    exit 1
fi

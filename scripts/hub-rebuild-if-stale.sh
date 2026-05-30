#!/bin/bash
# Rebuild the hub if the running build is behind HEAD.
# Safe to run any time — no-ops if already up to date.
#
# Usage:
#   scripts/hub-rebuild-if-stale.sh           # from repo root
#   scripts/hub-rebuild-if-stale.sh --force   # rebuild regardless
#
# Launchd: run as a periodic job (e.g. every 5 min) to keep hub current.
#
# Atomic deploy: the build runs into a staging dir (hub/build.staging) while the
# live hub keeps serving the OLD build, then the staging dir is swapped into place
# and the hub is restarted. Downtime is ~1s (the swap + restart), not the ~30s
# build, and the live build/ is never half-written — this kills the rebuild race
# that intermittently served broken/missing JS chunks. A failed build leaves the
# running hub untouched on its old build.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR=$(python3 -c "import json; print(json.load(open('$HOME/.relaygent/config.json'))['paths']['data'])" 2>/dev/null || echo "$REPO_DIR/data")
BUILD_COMMIT="$DATA_DIR/hub-build-commit"
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

# Serialize against the relay's session-start rebuild (harness/relay_hub.py). Both
# write hub/build/, and overlapping rebuilds can leave build/ referencing a chunk the
# other build never emitted — a 500-on-every-page stale manifest. mkdir is the atomic
# lock primitive (portable — macOS has no flock(1)); the relay side locks the same dir.
LOCK="$HOME/.relaygent/hub-rebuild.lock"
LOCK_STALE_SECS=300  # > build timeout (never steal a live build); self-heals a wedged lock in one autobuild cycle
if ! mkdir "$LOCK" 2>/dev/null; then
    lock_mtime=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0)
    if [ $(( $(date +%s) - lock_mtime )) -gt "$LOCK_STALE_SECS" ]; then
        rm -rf "$LOCK"  # stale lock from a crashed rebuild
        mkdir "$LOCK" 2>/dev/null || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] Hub rebuild lock busy — skipping." | tee -a "$LOG"; exit 0; }
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another hub rebuild in progress — skipping." | tee -a "$LOG"
        exit 0
    fi
fi
trap 'rm -rf "$LOCK"' EXIT

# Re-check staleness now that we hold the lock — a rebuild we were racing may have
# just landed the current commit while we waited.
BUILT=$(cat "$BUILD_COMMIT" 2>/dev/null || echo "")
if [ "$FORCE" != "--force" ] && [ "$HEAD" = "$BUILT" ]; then
    exit 0  # trap releases the lock
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding hub (was: ${BUILT:0:8}, now: ${HEAD:0:8})" | tee -a "$LOG"

HUB_PLIST="$HOME/Library/LaunchAgents/com.relaygent.hub.plist"
GUID="gui/$(id -u)"
STAGING="$REPO_DIR/hub/build.staging"

# Build into a staging dir while the live hub keeps serving the old build.
# Clear the SvelteKit incremental cache first — a stale .svelte-kit can yield a
# manifest that imports a chunk hash the build didn't emit (ERR_MODULE_NOT_FOUND).
rm -rf "$STAGING" "$REPO_DIR/hub/.svelte-kit"
if ! HUB_BUILD_OUT="build.staging" npm run build --prefix "$REPO_DIR/hub" >> "$LOG" 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuild FAILED — hub still serving old build." | tee -a "$LOG"
    rm -rf "$STAGING"
    exit 1
fi

# Build succeeded: swap staging into place and restart. Use bootout/bootstrap (not
# stop/start) — KeepAlive:true means stop immediately restarts.
launchctl bootout "$GUID" "$HUB_PLIST" 2>/dev/null || true
# Wait for port to be free (hub has 3s shutdown timeout)
for i in 1 2 3 4 5; do
    lsof -ti:${PORT:-8080} >/dev/null 2>&1 || break
    sleep 1
done
rm -rf "$REPO_DIR/hub/build.old"
mv "$REPO_DIR/hub/build" "$REPO_DIR/hub/build.old" 2>/dev/null || true
mv "$STAGING" "$REPO_DIR/hub/build"
echo "$HEAD" > "$BUILD_COMMIT"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuild complete (atomic swap)." | tee -a "$LOG"
launchctl bootstrap "$GUID" "$HUB_PLIST"

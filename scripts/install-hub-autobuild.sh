#!/bin/bash
# Install the hub auto-rebuild launchd job (macOS only).
# Runs hub-rebuild-if-stale.sh every 5 minutes to keep the hub build current.
#
# Usage: scripts/install-hub-autobuild.sh [--uninstall]
#
# After install, the job runs immediately and then every 5 minutes.
# Logs go to: logs/hub-autobuild.log

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.relaygent.hub-autobuild"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE="$(command -v node 2>/dev/null || echo "/opt/homebrew/bin/node")"

if [ "$(uname)" != "Darwin" ]; then
    echo "launchd is macOS-only. On Linux, use cron:" >&2
    echo "  */5 * * * * $REPO_DIR/scripts/hub-rebuild-if-stale.sh" >&2
    exit 1
fi

if [ "${1:-}" = "--uninstall" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Uninstalled $LABEL"
    exit 0
fi

mkdir -p "$(dirname "$PLIST")"
mkdir -p "$REPO_DIR/logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${REPO_DIR}/scripts/hub-rebuild-if-stale.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$HOME/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>StandardOutPath</key>
    <string>${REPO_DIR}/logs/hub-autobuild.log</string>
    <key>StandardErrorPath</key>
    <string>${REPO_DIR}/logs/hub-autobuild.log</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

# Unload first if already installed
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed and started $LABEL"
echo "  Rebuilds hub every 5 min if stale. Logs: $REPO_DIR/logs/hub-autobuild.log"

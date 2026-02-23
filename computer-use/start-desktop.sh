#!/bin/bash
# Start GNOME desktop on Xvfb display :99.
# Also starts linux-server.py for computer-use MCP tools.
#
# Usage: ./start-desktop.sh
# Requires: Xvfb already running on :99

set -euo pipefail

DISPLAY=:99
export DISPLAY

# Check Xvfb is running
if ! xdpyinfo -display "$DISPLAY" &>/dev/null; then
    echo "Error: Xvfb not running on $DISPLAY" >&2
    exit 1
fi

# Kill stale Chrome and desktop to prevent multiple instances
pkill -u "$(whoami)" -f 'google-chrome|chromium' 2>/dev/null || true
pkill -u "$(whoami)" gnome-shell 2>/dev/null || true
pkill -u "$(whoami)" gnome-session 2>/dev/null || true
sleep 1

# Suppress GNOME Welcome dialog
mkdir -p ~/.config
echo "yes" > ~/.config/gnome-initial-setup-done 2>/dev/null || true

# Start gnome-shell directly in X11 mode (gnome-session fails on Xvfb because
# it can't establish a proper logind session — gnome-shell --x11 works standalone)
gnome-shell --x11 > /tmp/gnome-shell.log 2>&1 &
echo "gnome-shell started (PID $!)"

# Wait for gnome-shell to appear
for i in $(seq 1 10); do
    if pgrep -u "$(whoami)" gnome-shell &>/dev/null; then
        echo "GNOME shell running after ${i}s"
        break
    fi
    sleep 1
done

if ! pgrep -u "$(whoami)" gnome-shell &>/dev/null; then
    echo "Warning: gnome-shell did not start" >&2
fi

# Dismiss Welcome dialog if it appears
wmctrl -c "Welcome" 2>/dev/null || true

# Start computer-use HTTP server if not already running
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! pgrep -f "linux-server.py" &>/dev/null; then
    python3 "$SCRIPT_DIR/linux-server.py" > /tmp/linux-server.log 2>&1 &
    echo "linux-server.py started (PID $!)"
else
    echo "linux-server.py already running"
fi

echo "Desktop ready on $DISPLAY"

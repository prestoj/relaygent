#!/bin/bash
# Relaygent container entrypoint.
# Starts desktop + hub + noVNC pre-auth, then watches for Claude auth.
set -euo pipefail

HOME=/home/relaygent
REPO="$HOME/relaygent"
LOGS="$REPO/logs"
DATA="$REPO/data"
KB="$REPO/knowledge/topics"
PID_DIR="$HOME/.relaygent"
export HOME DISPLAY=:99 REPO LOGS DATA KB PID_DIR

mkdir -p "$LOGS" "$DATA" "$PID_DIR"

echo "=== Relaygent Container Starting ==="

# 1. Xvfb (virtual display)
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp > "$LOGS/xvfb.log" 2>&1 &
echo $! > "$PID_DIR/xvfb.pid"
sleep 1
echo "  Xvfb: started (DISPLAY=:99)"

# 2. D-Bus — session bus for general IPC
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    eval "$(dbus-launch --sh-syntax)"
    export DBUS_SESSION_BUS_ADDRESS
fi

# 2b. System D-Bus + logind (gnome-shell needs org.freedesktop.login1)
if [ ! -S /var/run/dbus/system_bus_socket ]; then
    sudo mkdir -p /var/run/dbus
    sudo dbus-daemon --system --fork
    echo "  System D-Bus: started"
fi
if ! pgrep -f systemd-logind &>/dev/null; then
    sudo /usr/lib/systemd/systemd-logind > "$LOGS/logind.log" 2>&1 &
    sleep 2
    echo "  logind: started"
fi

# 3. GNOME desktop (software rendering — no GPU in containers)
export LIBGL_ALWAYS_SOFTWARE=1
export MUTTER_ALLOW_SOFTWARE_RENDERING=1
mkdir -p "$HOME/.config"
echo "yes" > "$HOME/.config/gnome-initial-setup-done" 2>/dev/null || true
gnome-shell --x11 > "$LOGS/gnome.log" 2>&1 &
sleep 2
wmctrl -c "Welcome" 2>/dev/null || true
echo "  GNOME: started"

# 4. x11vnc (VNC server on :5900)
VNC_OPTS="-display :99 -nopw -shared -forever -rfbport 5900"
if [ -f "$HOME/.relaygent/vnc-password" ]; then
    VNC_OPTS="-display :99 -rfbauth $HOME/.relaygent/vnc-password -shared -forever -rfbport 5900"
fi
x11vnc $VNC_OPTS > "$LOGS/x11vnc.log" 2>&1 &
echo $! > "$PID_DIR/vnc.pid"
sleep 1
echo "  x11vnc: started (port 5900)"

# 5. Computer-use server
DISPLAY=:99 python3 "$REPO/computer-use/linux-server.py" > "$LOGS/computer-use.log" 2>&1 &
echo $! > "$PID_DIR/computer-use.pid"
echo "  Computer-use: started"

# 6. Hub (dashboard + noVNC)
PORT=8080 \
RELAY_STATUS_FILE="$DATA/relay-status.json" \
RELAYGENT_KB_DIR="$KB" \
RELAYGENT_DATA_DIR="$DATA" \
RELAYGENT_NOTIFICATIONS_PORT=8083 \
    node "$REPO/hub/ws-server.mjs" > "$LOGS/hub.log" 2>&1 &
echo $! > "$PID_DIR/hub.pid"
sleep 1
echo "  Hub: started (port 8080)"

# 7. Notifications
"$REPO/notifications/.venv/bin/python3" "$REPO/notifications/server.py" > "$LOGS/notifications.log" 2>&1 &
echo $! > "$PID_DIR/notifications.pid"
echo "  Notifications: started (port 8083)"

# 8. Chrome (auto-launch with hub dashboard)
CHROME_DATA="$DATA/chrome-debug-profile"
for f in SingletonLock SingletonSocket SingletonCookie; do rm -f "$CHROME_DATA/$f" 2>/dev/null; done
BROWSER=$(command -v google-chrome || command -v chromium-browser || command -v chromium || echo "")
if [ -n "$BROWSER" ]; then
    mkdir -p "$CHROME_DATA/Default"
    DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 "$BROWSER" \
        --no-sandbox --no-first-run --disable-gpu --disable-default-apps \
        --remote-debugging-port=9222 --user-data-dir="$CHROME_DATA" \
        "http://localhost:8080" > "$LOGS/chrome.log" 2>&1 &
    echo $! > "$PID_DIR/chrome.pid"
    echo "  Chrome: started (CDP port 9222)"
fi

echo ""
echo "=== Services Ready ==="
echo "  Hub:     http://localhost:8080"
echo "  VNC:     vnc://localhost:5900"
echo "  noVNC:   http://localhost:8080/screen"
echo ""

# 9. Watch for Claude auth and auto-start relay
if [ -d "$HOME/.claude" ]; then
    echo "  Claude auth found — starting relay..."
    python3 "$REPO/harness/relay.py" > "$LOGS/relay.log" 2>&1 &
    echo $! > "$PID_DIR/relay.pid"
    echo "  Relay: started"
else
    echo "  Claude not authenticated yet."
    echo "  Connect via noVNC → open terminal → run 'claude' to log in."
    echo "  Watching for auth..."
    # Open terminal with setup instructions so user sees them via VNC
    gnome-terminal -- bash -c '
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  Welcome to Relaygent!"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "  To get started, run:"
        echo "    claude"
        echo ""
        echo "  Complete the browser login, then"
        echo "  the agent will start automatically."
        echo ""
        exec bash' 2>/dev/null &
    (
        while [ ! -d "$HOME/.claude" ]; do sleep 5; done
        echo "  Claude auth detected — starting relay..."
        python3 "$REPO/harness/relay.py" > "$LOGS/relay.log" 2>&1 &
        echo $! > "$PID_DIR/relay.pid"
        echo "  Relay: started"
    ) &
fi

# 10. Watchdog — restart crashed services every 30s
export VNC_OPTS BROWSER="${BROWSER:-}" CHROME_DATA
echo ""
echo "=== Relaygent Ready ==="
bash "$REPO/docker/watchdog.sh" &
wait

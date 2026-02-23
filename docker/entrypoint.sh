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
export HOME DISPLAY=:99

mkdir -p "$LOGS" "$DATA" "$PID_DIR"

echo "=== Relaygent Container Starting ==="

# 1. Xvfb (virtual display)
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp > "$LOGS/xvfb.log" 2>&1 &
echo $! > "$PID_DIR/xvfb.pid"
sleep 1
echo "  Xvfb: started (DISPLAY=:99)"

# 2. D-Bus (required for GNOME)
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    eval "$(dbus-launch --sh-syntax)"
    export DBUS_SESSION_BUS_ADDRESS
fi

# 3. GNOME desktop
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

echo ""
echo "=== Services Ready ==="
echo "  Hub:     http://localhost:8080"
echo "  VNC:     vnc://localhost:5900"
echo "  noVNC:   http://localhost:8080/screen"
echo ""

# 8. Watch for Claude auth and auto-start relay
if [ -d "$HOME/.claude" ]; then
    echo "  Claude auth found — starting relay..."
    python3 "$REPO/harness/relay.py" > "$LOGS/relay.log" 2>&1 &
    echo $! > "$PID_DIR/relay.pid"
    echo "  Relay: started"
else
    echo "  Claude not authenticated yet."
    echo "  Connect via noVNC → open terminal → run 'claude' to log in."
    echo "  Watching for auth..."
    (
        while [ ! -d "$HOME/.claude" ]; do sleep 5; done
        echo "  Claude auth detected — starting relay..."
        python3 "$REPO/harness/relay.py" > "$LOGS/relay.log" 2>&1 &
        echo $! > "$PID_DIR/relay.pid"
        echo "  Relay: started"
    ) &
fi

# 9. Watchdog — restart crashed services every 30s
watchdog() {
    sleep 30
    while true; do
        # Hub
        if ! curl -sf --max-time 2 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
            if ! pgrep -f "ws-server.mjs" >/dev/null 2>&1; then
                echo "[watchdog] Restarting hub..."
                PORT=8080 RELAY_STATUS_FILE="$DATA/relay-status.json" RELAYGENT_KB_DIR="$KB" \
                    RELAYGENT_DATA_DIR="$DATA" RELAYGENT_NOTIFICATIONS_PORT=8083 \
                    node "$REPO/hub/ws-server.mjs" >> "$LOGS/hub.log" 2>&1 &
                echo $! > "$PID_DIR/hub.pid"
            fi
        fi
        # Notifications
        if ! curl -sf --max-time 2 http://127.0.0.1:8083/health >/dev/null 2>&1; then
            if ! pgrep -f "notifications/server.py" >/dev/null 2>&1; then
                echo "[watchdog] Restarting notifications..."
                "$REPO/notifications/.venv/bin/python3" "$REPO/notifications/server.py" \
                    >> "$LOGS/notifications.log" 2>&1 &
                echo $! > "$PID_DIR/notifications.pid"
            fi
        fi
        # x11vnc
        if ! pgrep -f "x11vnc" >/dev/null 2>&1; then
            echo "[watchdog] Restarting x11vnc..."
            x11vnc $VNC_OPTS >> "$LOGS/x11vnc.log" 2>&1 &
            echo $! > "$PID_DIR/vnc.pid"
        fi
        # Computer-use
        if ! pgrep -f "linux-server.py" >/dev/null 2>&1; then
            echo "[watchdog] Restarting computer-use..."
            DISPLAY=:99 python3 "$REPO/computer-use/linux-server.py" \
                >> "$LOGS/computer-use.log" 2>&1 &
            echo $! > "$PID_DIR/computer-use.pid"
        fi
        sleep 30
    done
}

echo ""
echo "=== Relaygent Ready ==="

# Run watchdog, keep container alive
watchdog &
wait

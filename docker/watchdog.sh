#!/bin/bash
# Docker container watchdog — restarts crashed services every 30s.
# Called by entrypoint.sh. Expects env vars: REPO, LOGS, DATA, KB, PID_DIR,
# VNC_OPTS, BROWSER, CHROME_DATA.
set -uo pipefail

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
    # GNOME shell
    if ! pgrep -x "gnome-shell" >/dev/null 2>&1; then
        echo "[watchdog] Restarting gnome-shell..."
        DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 MUTTER_ALLOW_SOFTWARE_RENDERING=1 \
            gnome-shell --x11 >> "$LOGS/gnome.log" 2>&1 &
    fi
    # Chrome
    if [ -n "${BROWSER:-}" ] && ! pgrep -f "chrome|chromium" >/dev/null 2>&1; then
        echo "[watchdog] Restarting Chrome..."
        for f in SingletonLock SingletonSocket SingletonCookie; do rm -f "$CHROME_DATA/$f" 2>/dev/null; done
        DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 "$BROWSER" --no-sandbox --no-first-run --disable-gpu \
            --remote-debugging-port=9222 --user-data-dir="$CHROME_DATA" \
            "http://localhost:8080" >> "$LOGS/chrome.log" 2>&1 &
        echo $! > "$PID_DIR/chrome.pid"
    fi
    sleep 30
done

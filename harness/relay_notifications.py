"""Notifications service health check and auto-start.

The relay self-heals the hub on session start (see relay_hub.check_and_rebuild_hub)
but the notifications service (port 8083) was only ever started by start.sh. When
it dies — e.g. killed during a user-session recycle — nothing restarts it, so it
stays silently down while the relay keeps polling /notifications/pending and routing
cron/task/chat wakes through it. This ensures it's running, mirroring the hub.

Linux-only: macOS installs run notifications under a LaunchAgent (see start.sh
platform_start), which manages its own lifecycle; we don't second-guess it here.
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from config import REPO_DIR, log


def _notifications_port() -> str:
    """Port from env, else config.json, else 8083 — same precedence as the relay."""
    config_file = Path.home() / ".relaygent" / "config.json"
    port = "8083"
    if config_file.exists():
        try:
            cfg = json.loads(config_file.read_text())
            port = str(cfg.get("services", {}).get("notifications", {}).get("port", 8083))
        except (json.JSONDecodeError, OSError):
            pass
    return os.environ.get("RELAYGENT_NOTIFICATIONS_PORT", port)


def _is_healthy(port: str) -> bool:
    """True if the notifications /health endpoint answers 200."""
    try:
        url = f"http://127.0.0.1:{port}/health"
        with urllib.request.urlopen(url, timeout=3) as resp:
            return getattr(resp, "status", resp.getcode()) == 200
    except Exception:
        return False


def ensure_notifications_running() -> None:
    """Start the notifications service if it isn't already answering /health.

    Health-gated so it's a no-op when the service is up (and so it never races a
    macOS LaunchAgent). Flask's app.run exits immediately on EADDRINUSE, so even a
    spurious start is self-limiting rather than a port-fighting orphan.
    """
    if sys.platform == "darwin":
        return

    port = _notifications_port()
    if _is_healthy(port):
        return

    notif_dir = REPO_DIR / "notifications"
    server = notif_dir / "server.py"
    if not server.exists():
        return
    venv_py = notif_dir / ".venv" / "bin" / "python3"
    python = str(venv_py) if venv_py.exists() else sys.executable

    env = os.environ.copy()
    env["RELAYGENT_NOTIFICATIONS_PORT"] = port
    # server.py warns and skips cron tasks without KB_DIR; default both like start.sh.
    env.setdefault("RELAYGENT_KB_DIR", str(REPO_DIR / "knowledge" / "topics"))
    env.setdefault("RELAYGENT_DATA_DIR", str(REPO_DIR / "data"))

    log_dir = REPO_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    try:
        log_file = open(log_dir / "relaygent-notifications.log", "a")
    except OSError as e:
        log(f"Failed to open notifications log: {e}")
        return
    try:
        # start_new_session=True detaches it so it outlives this relay process
        # (the relay respawns far more often than the notifications service should).
        proc = subprocess.Popen(
            [python, str(server)],
            stdout=log_file, stderr=subprocess.STDOUT,
            env=env, cwd=str(notif_dir), start_new_session=True,
        )
    except OSError as e:
        log(f"Failed to start notifications: {e}")
        log_file.close()
        return
    log_file.close()  # safe to close in parent after fork
    pid_file = Path.home() / ".relaygent" / "notifications.pid"
    try:
        pid_file.write_text(f"{proc.pid}\n")
    except OSError:
        pass
    log(f"Notifications service started on :{port} (PID {proc.pid})")

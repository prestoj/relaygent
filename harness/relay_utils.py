"""Utility functions for the relay harness."""

import fcntl
import os
import signal
import subprocess
import sys
from pathlib import Path

from config import LOG_FILE, LOG_MAX_SIZE, LOG_TRUNCATE_SIZE, REPO_DIR, SCRIPT_DIR, log

LOCK_FILE = SCRIPT_DIR / ".relay.lock"
PID_FILE = Path.home() / ".relaygent" / "relay.pid"


def write_pid_file() -> None:
    """Write current process PID to ~/.relaygent/relay.pid."""
    try:
        PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        PID_FILE.write_text(f"{os.getpid()}\n")
    except OSError as e:
        log(f"WARNING: Could not write pid file: {e}")


def cleanup_pid_file() -> None:
    """Remove pid file if it belongs to this process."""
    try:
        if PID_FILE.exists() and PID_FILE.read_text().strip() == str(os.getpid()):
            PID_FILE.unlink()
    except OSError:
        pass


def acquire_lock() -> int:
    """Acquire exclusive lock. Returns fd or exits if already locked."""
    fd = os.open(str(LOCK_FILE), os.O_RDWR | os.O_CREAT)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        os.fsync(fd)
        return fd
    except BlockingIOError:
        os.close(fd)
        log("Another relay instance is running, exiting")
        sys.exit(0)


def kill_orphaned_claudes() -> None:
    """Kill any leftover claude --resume/--print processes."""
    result = subprocess.run(
        ["pgrep", "-f", "claude.*--print.*--session-id"],
        capture_output=True, text=True
    )
    if result.returncode == 0 and result.stdout.strip():
        for pid_str in result.stdout.strip().split('\n'):
            try:
                pid = int(pid_str)
                os.kill(pid, signal.SIGTERM)
                log(f"Sent SIGTERM to orphaned claude process {pid}")
            except (ProcessLookupError, ValueError):
                pass


def notify_crash(crash_count: int, exit_code: int) -> None:
    """Alert the user about repeated crashes via hub chat + Slack + log."""
    msg = (f"Relay crashed {crash_count} times (exit code {exit_code}). "
           f"Manual intervention may be needed.")
    log(f"CRASH ALERT: {msg}")
    _send_chat_alert(msg)
    _send_slack_alert(f":rotating_light: *Relay crash alert*: {msg}")


def notify_lifecycle(event: str, detail: str = "") -> None:
    """Lightweight hub chat notification for session lifecycle events."""
    msg = f"[relay] {event}" + (f" — {detail}" if detail else "")
    _send_chat_alert(msg)


def _send_chat_alert(message: str) -> None:
    """Best-effort alert to the user via hub chat."""
    import json
    import urllib.error
    import urllib.request
    hub_port = os.environ.get("RELAYGENT_HUB_PORT", "8080")
    url = f"http://127.0.0.1:{hub_port}/api/chat"
    try:
        data = json.dumps({"content": message, "role": "assistant"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except (urllib.error.URLError, OSError) as e:
        log(f"Chat alert failed (hub may be down): {e}")


def _send_slack_alert(message: str) -> None:
    """Best-effort alert via Slack — posts to channel from config, or #general."""
    import json
    import urllib.error
    import urllib.parse
    import urllib.request
    token_file = Path.home() / ".relaygent" / "slack" / "token.json"
    config_file = Path.home() / ".relaygent" / "config.json"
    try:
        token = json.loads(token_file.read_text()).get("token", "")
        if not token:
            return
        config = json.loads(config_file.read_text()) if config_file.exists() else {}
        channel = config.get("slack", {}).get("alert_channel", "general")
        params = urllib.parse.urlencode({"token": token, "channel": channel, "text": message}).encode()
        req = urllib.request.Request("https://slack.com/api/chat.postMessage", data=params,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        urllib.request.urlopen(req, timeout=5)
    except (urllib.error.URLError, OSError):
        log("Slack alert failed (token or network issue)")


def pull_latest() -> None:
    """Pull latest code from origin/main (best-effort, fast-forward only)."""
    try:
        result = subprocess.run(
            ["git", "-C", str(REPO_DIR), "pull", "--ff-only", "origin", "main"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            output = result.stdout.strip()
            if "Already up to date" not in output:
                log(f"Pulled latest: {output.splitlines()[-1]}")
        else:
            log(f"Git pull skipped: {result.stderr.strip()[:200]}")
    except (subprocess.SubprocessError, OSError) as e:
        log(f"Git pull failed: {e}")


def startup_init() -> None:
    """Run all startup tasks: pid file, orphan cleanup, pull, hub check, Slack ack."""
    write_pid_file()
    kill_orphaned_claudes()
    pull_latest()
    check_and_rebuild_hub()
    # Ack Slack so stale unreads from while we were offline don't re-trigger
    try:
        import urllib.request
        notifications_port = os.environ.get("RELAYGENT_NOTIFICATIONS_PORT", "8083")
        url = f"http://127.0.0.1:{notifications_port}/notifications/ack-slack"
        urllib.request.urlopen(urllib.request.Request(url, method="POST", data=b""), timeout=3)
        log("Slack acked at startup")
    except Exception:
        pass  # Best-effort


def commit_kb() -> None:
    """Commit knowledge base changes."""
    commit_script = REPO_DIR / "knowledge" / "commit.sh"
    if commit_script.exists() and os.access(commit_script, os.X_OK):
        try:
            env = os.environ.copy()
            env["RELAY_RUN"] = "1"
            result = subprocess.run([str(commit_script)], env=env, capture_output=True, timeout=30)
            if result.returncode == 0:
                log("KB changes committed")
            else:
                log(f"KB commit failed (exit {result.returncode}): {result.stderr.decode(errors='replace').strip()}")
        except (subprocess.SubprocessError, OSError) as e:
            log(f"KB commit failed: {e}")


def rotate_log() -> None:
    """Rotate the relay log if it exceeds the size limit."""
    if not LOG_FILE.exists():
        return
    try:
        size = LOG_FILE.stat().st_size
        if size > LOG_MAX_SIZE:
            content = LOG_FILE.read_bytes()[-LOG_TRUNCATE_SIZE:]
            # Skip to first complete line to avoid splitting mid-line
            newline_pos = content.find(b"\n")
            if 0 <= newline_pos < len(content) - 1:
                content = content[newline_pos + 1:]
            LOG_FILE.write_bytes(content)
            log(f"Log rotated (was {size} bytes)")
    except OSError as e:
        log(f"WARNING: Log rotation failed: {e}")


def cleanup_context_file() -> None:
    """Remove the context percentage tracking file."""
    pct_file = Path("/tmp/relaygent-context-pct")
    if pct_file.exists():
        pct_file.unlink()


# Re-export for callers that import from relay_utils
from relay_hub import check_and_rebuild_hub  # noqa: E402, F401

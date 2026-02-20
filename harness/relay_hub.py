"""Hub build staleness check and auto-rebuild."""

import json
import os
import signal
import subprocess
import time
from pathlib import Path

from config import REPO_DIR, log


def check_and_rebuild_hub() -> None:
    """Rebuild hub if build is stale (git HEAD differs from last built commit)."""
    build_commit_file = REPO_DIR / "data" / "hub-build-commit"
    try:
        current = subprocess.run(
            ["git", "-C", str(REPO_DIR), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return

    if not current:
        return

    if build_commit_file.exists() and build_commit_file.read_text().strip() == current:
        log("Hub build is current, skipping rebuild")
        return

    log("Hub build is stale — rebuilding...")
    config_file = Path.home() / ".relaygent" / "config.json"
    hub_port = "8080"
    kb_dir = str(REPO_DIR / "knowledge" / "topics")
    pid_dir = Path.home() / ".relaygent"
    if config_file.exists():
        try:
            cfg = json.loads(config_file.read_text())
            hub_port = str(cfg.get("hub", {}).get("port", 8080))
            kb_dir = cfg.get("paths", {}).get("kb", kb_dir)
        except (json.JSONDecodeError, OSError):
            pass

    hub_dir = REPO_DIR / "hub"
    result = subprocess.run(
        ["npm", "run", "build", "--prefix", str(hub_dir)],
        capture_output=True, timeout=120
    )
    if result.returncode != 0:
        log(f"Hub rebuild failed: {result.stderr.decode(errors='replace').strip()[-500:]}")
        return

    build_commit_file.parent.mkdir(parents=True, exist_ok=True)
    build_commit_file.write_text(current)
    log("Hub rebuilt successfully")

    # Restart hub
    hub_pid_file = pid_dir / "hub.pid"
    if hub_pid_file.exists():
        try:
            old_pid = int(hub_pid_file.read_text().strip())
            os.kill(old_pid, signal.SIGTERM)
            for _ in range(3):
                time.sleep(1)
                try:
                    os.kill(old_pid, 0)
                except ProcessLookupError:
                    break
        except (OSError, ValueError):
            pass
    hub_pid_file.unlink(missing_ok=True)

    log_dir = REPO_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update({
        "PORT": hub_port,
        "RELAY_STATUS_FILE": str(REPO_DIR / "data" / "relay-status.json"),
        "RELAYGENT_KB_DIR": kb_dir,
    })
    proc = subprocess.Popen(
        ["node", str(hub_dir / "server.js")],
        stdout=open(log_dir / "relaygent-hub.log", "a"),
        stderr=subprocess.STDOUT,
        env=env,
    )
    hub_pid_file.write_text(f"{proc.pid}\n")
    log(f"Hub restarted on :{hub_port} (PID {proc.pid})")

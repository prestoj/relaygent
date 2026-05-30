"""Hub build staleness check and auto-rebuild."""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from config import REPO_DIR, log
from hub_build import hub_build_lock, hub_healthy as _hub_healthy

LAUNCHAGENT_LABEL = "com.relaygent.hub"
LAUNCHAGENT_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHAGENT_LABEL}.plist"


def _launchctl(*args, timeout=10) -> bool:
    """Run launchctl with given args. Returns True on success."""
    try:
        r = subprocess.run(["launchctl", *args], capture_output=True, timeout=timeout)
        return r.returncode == 0
    except (subprocess.SubprocessError, OSError, FileNotFoundError):
        return False


def _hub_uses_launchagent() -> bool:
    return sys.platform == "darwin" and LAUNCHAGENT_PLIST.exists()


def _hub_build_lock_dir() -> Path:
    return Path.home() / ".relaygent" / "hub-rebuild.lock"


def _load_config() -> dict:
    """Load config values with sensible defaults."""
    config_file = Path.home() / ".relaygent" / "config.json"
    defaults = {
        "hub_port": "8080",
        "kb_dir": str(REPO_DIR / "knowledge" / "topics"),
        "data_dir": str(REPO_DIR / "data"),
        "notifications_port": "8083",
    }
    if config_file.exists():
        try:
            cfg = json.loads(config_file.read_text())
            defaults["hub_port"] = str(cfg.get("hub", {}).get("port", 8080))
            defaults["kb_dir"] = cfg.get("paths", {}).get("kb", defaults["kb_dir"])
            defaults["data_dir"] = cfg.get("paths", {}).get("data", defaults["data_dir"])
            defaults["notifications_port"] = str(
                cfg.get("services", {}).get("notifications", {}).get("port", 8083))
        except (json.JSONDecodeError, OSError):
            pass
    return defaults


def _restart_only(conf: dict) -> None:
    _start_hub(_hub_uses_launchagent(), conf["hub_port"], conf["kb_dir"], conf["data_dir"],
               conf["notifications_port"], Path.home() / ".relaygent")


def check_and_rebuild_hub() -> None:
    """Rebuild hub if build is stale (git HEAD differs from last built commit).

    Rebuilds run under a cross-process lock shared with the 5-min autobuild so the
    two never write hub/build/ at the same time (the stale-manifest race).
    """
    conf = _load_config()
    hub_port = conf["hub_port"]
    build_commit_file = Path(conf["data_dir"]) / "hub-build-commit"
    try:
        current = subprocess.run(
            ["git", "-C", str(REPO_DIR), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return

    if not current:
        return

    # Fast path: build current and hub responding — no work, no lock needed.
    if (build_commit_file.exists()
            and build_commit_file.read_text().strip() == current
            and _hub_healthy(hub_port)):
        log("Hub build is current and responding, skipping rebuild")
        return

    # Stale, or current-but-down: take the rebuild lock so we can't collide with the
    # autobuild. If it's held, another rebuild is in flight — skip and just ensure the
    # hub is running; the in-flight build will become current shortly.
    with hub_build_lock(_hub_build_lock_dir()) as acquired:
        if not acquired:
            log("Hub rebuild already in progress (autobuild) — skipping")
            if not _hub_healthy(hub_port):
                _restart_only(conf)
            return

        # Re-read inside the lock — the autobuild may have just finished.
        built = build_commit_file.read_text().strip() if build_commit_file.exists() else ""
        if built == current:
            if _hub_healthy(hub_port):
                log("Hub build is current and responding, skipping rebuild")
                return
            log("Hub build is current but not responding — restarting hub")
            _restart_only(conf)
            return

        _rebuild_hub(conf, current, build_commit_file)


def _rebuild_hub(conf: dict, current: str, build_commit_file: Path) -> None:
    """Rebuild the hub from source. Caller must hold the rebuild lock."""
    log("Hub build is stale — rebuilding...")
    pid_dir = Path.home() / ".relaygent"
    uses_launchagent = _hub_uses_launchagent()

    # Stop hub before building so it doesn't serve a broken state mid-build
    if uses_launchagent:
        log("Stopping hub via launchctl...")
        _launchctl("stop", LAUNCHAGENT_LABEL)
        time.sleep(2)
    else:
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

    hub_dir = REPO_DIR / "hub"
    # Clear the SvelteKit incremental cache: a stale .svelte-kit can yield a manifest
    # importing a chunk the build didn't emit (ERR_MODULE_NOT_FOUND → 500 everywhere).
    shutil.rmtree(hub_dir / ".svelte-kit", ignore_errors=True)
    result = subprocess.run(
        ["npm", "run", "build", "--prefix", str(hub_dir)],
        capture_output=True, timeout=120
    )
    if result.returncode != 0:
        log(f"Hub rebuild failed: {result.stderr.decode(errors='replace').strip()[-500:]}")
    else:
        build_commit_file.parent.mkdir(parents=True, exist_ok=True)
        build_commit_file.write_text(current)
        log("Hub rebuilt successfully")

    # Restart hub (even on build failure — serve old build rather than nothing)
    _start_hub(uses_launchagent, conf["hub_port"], conf["kb_dir"], conf["data_dir"],
               conf["notifications_port"], pid_dir)


def _start_hub(uses_launchagent, hub_port, kb_dir, data_dir, notifications_port, pid_dir):
    """Start (or restart) the hub process."""
    if uses_launchagent:
        log("Starting hub via launchctl...")
        _launchctl("start", LAUNCHAGENT_LABEL)
        time.sleep(2)
        log(f"Hub restarted on :{hub_port} (via LaunchAgent)")
    else:
        log_dir = REPO_DIR / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update({
            "PORT": hub_port,
            "RELAY_STATUS_FILE": str(Path(data_dir) / "relay-status.json"),
            "RELAYGENT_KB_DIR": kb_dir,
            "RELAYGENT_DATA_DIR": data_dir,
            "RELAYGENT_NOTIFICATIONS_PORT": notifications_port,
        })
        hub_pid_file = pid_dir / "hub.pid"
        log_file = open(log_dir / "relaygent-hub.log", "a")
        try:
            proc = subprocess.Popen(
                ["node", str(REPO_DIR / "hub" / "ws-server.mjs")],
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env=env,
            )
        except OSError as e:
            log(f"Failed to start hub: {e}")
            log_file.close()
            return
        log_file.close()  # Safe to close in parent after fork
        hub_pid_file.write_text(f"{proc.pid}\n")
        log(f"Hub restarted on :{hub_port} (PID {proc.pid})")

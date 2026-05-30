"""Hub build staleness check and auto-rebuild."""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from config import REPO_DIR, log

LAUNCHAGENT_LABEL = "com.relaygent.hub"
LAUNCHAGENT_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHAGENT_LABEL}.plist"

# A rebuild that crashes mid-flight could leave the lock dir behind; treat a lock
# older than this as stale and steal it. Comfortably above the 120s build timeout
# (so a live build is never stolen from) yet short enough that a wedged lock
# self-heals within one 5-min autobuild cycle.
_LOCK_STALE_SECS = 300


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


@contextmanager
def _hub_build_lock():
    """Serialize hub rebuilds between the relay (here, on session start) and the
    5-min autobuild (scripts/hub-rebuild-if-stale.sh). Both write hub/build/, and
    when they overlap the result is a build/ whose manifest references a JS chunk
    the other build never emitted — a 500-on-every-page stale manifest (the bug
    this guards against). mkdir is the atomic acquire primitive and is portable:
    macOS has no flock(1), so both sides use a lock *directory* of the same name.

    Yields True if the lock was acquired (caller should rebuild), False if another
    rebuild already holds it (caller should skip and let that one land).
    """
    lock = _hub_build_lock_dir()
    lock.parent.mkdir(parents=True, exist_ok=True)
    acquired = False
    try:
        try:
            lock.mkdir()
            acquired = True
        except FileExistsError:
            try:
                age = time.time() - lock.stat().st_mtime
            except OSError:
                age = 0
            if age > _LOCK_STALE_SECS:
                shutil.rmtree(lock, ignore_errors=True)
                try:
                    lock.mkdir()
                    acquired = True
                except OSError:
                    pass
        yield acquired
    finally:
        if acquired:
            shutil.rmtree(lock, ignore_errors=True)


def _hub_healthy(hub_port: str, timeout: float = 3.0) -> bool:
    """Probe the hub's health endpoint. Returns True iff it responds 200.

    The hub may serve HTTPS (TLS) or plain HTTP depending on config, so try
    both. Used to detect a dead hub even when the build is current — e.g. after
    a cgroup kill takes the relay-managed hub down without a rebuild trigger.
    """
    import ssl
    import urllib.error
    import urllib.request

    https_ctx = ssl.create_default_context()
    https_ctx.check_hostname = False
    https_ctx.verify_mode = ssl.CERT_NONE
    for scheme, ctx in (("https", https_ctx), ("http", None)):
        try:
            with urllib.request.urlopen(
                f"{scheme}://127.0.0.1:{hub_port}/api/health", timeout=timeout, context=ctx
            ) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, OSError, ValueError):
            continue
    return False


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


def check_and_rebuild_hub() -> None:
    """Rebuild hub if build is stale (git HEAD differs from last built commit).

    Rebuilds run under a cross-process lock shared with the 5-min autobuild so
    the two never write hub/build/ at the same time (the stale-manifest race).
    """
    conf = _load_config()
    data_dir = conf["data_dir"]
    hub_port = conf["hub_port"]
    build_commit_file = Path(data_dir) / "hub-build-commit"
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

    # Stale, or current-but-down: take the rebuild lock so we don't collide with
    # the autobuild. If it's held, another rebuild is in flight — skip and just
    # make sure the hub is running; the in-flight build will become current soon.
    with _hub_build_lock() as acquired:
        if not acquired:
            log("Hub rebuild already in progress (autobuild) — skipping")
            if not _hub_healthy(hub_port):
                _start_hub(_hub_uses_launchagent(), hub_port, conf["kb_dir"], data_dir,
                           conf["notifications_port"], Path.home() / ".relaygent")
            return

        # Re-read inside the lock — the autobuild may have just finished.
        built = build_commit_file.read_text().strip() if build_commit_file.exists() else ""
        if built == current:
            if _hub_healthy(hub_port):
                log("Hub build is current and responding, skipping rebuild")
                return
            log("Hub build is current but not responding — restarting hub")
            _start_hub(_hub_uses_launchagent(), hub_port, conf["kb_dir"], data_dir,
                       conf["notifications_port"], Path.home() / ".relaygent")
            return

        _rebuild_hub(conf, current, build_commit_file)


def _rebuild_hub(conf: dict, current: str, build_commit_file: Path) -> None:
    """Rebuild the hub from source. Caller must hold the rebuild lock."""
    log("Hub build is stale — rebuilding...")
    hub_port = conf["hub_port"]
    kb_dir = conf["kb_dir"]
    data_dir = conf["data_dir"]
    notifications_port = conf["notifications_port"]
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
    # Clear the SvelteKit incremental cache before building. A stale .svelte-kit
    # can yield a build/ whose manifest imports a chunk hash the build didn't
    # emit → ERR_MODULE_NOT_FOUND → 500 on every page. A clean cache makes the
    # build self-consistent.
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
    _start_hub(uses_launchagent, hub_port, kb_dir, data_dir, notifications_port, pid_dir)


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

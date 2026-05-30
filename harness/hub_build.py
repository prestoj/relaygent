"""Helpers for the hub rebuild flow: a cross-process rebuild lock and a health probe.

Both the relay's session-start rebuild (relay_hub.py) and the 5-min autobuild
(scripts/hub-rebuild-if-stale.sh) write hub/build/. When they overlap the result
is a build/ whose manifest imports a chunk the other build never emitted — a
500-on-every-page stale manifest. mkdir is the atomic acquire primitive and is
portable (macOS has no flock(1)), so both sides use a lock *directory* of the same
name (~/.relaygent/hub-rebuild.lock).
"""

import os
import shutil
import ssl
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path

# A rebuild that crashes mid-flight could leave the lock dir behind. Treat a lock
# older than this as stale and steal it: comfortably above the 120s build timeout
# (so a live build is never stolen from), short enough that a wedged lock self-heals
# within one 5-min autobuild cycle.
LOCK_STALE_SECS = 300


@contextmanager
def hub_build_lock(lock_dir: Path):
    """Yield True if the lock at lock_dir was acquired (caller should rebuild),
    False if another rebuild holds a fresh lock (caller should skip). Released on
    exit; a stale lock (> LOCK_STALE_SECS) is stolen."""
    lock_dir.parent.mkdir(parents=True, exist_ok=True)
    acquired = False
    try:
        try:
            lock_dir.mkdir()
            acquired = True
        except FileExistsError:
            try:
                age = time.time() - lock_dir.stat().st_mtime
            except OSError:
                age = 0
            if age > LOCK_STALE_SECS:
                # Steal atomically: os.rename succeeds for exactly one racer (the
                # source vanishes for the loser, raising), so two simultaneous
                # stealers can't both delete + re-acquire (a double-rmtree TOCTOU
                # that would re-open the very race this lock closes).
                dead = lock_dir.with_name(f"{lock_dir.name}.dead.{os.getpid()}")
                try:
                    os.rename(lock_dir, dead)
                    shutil.rmtree(dead, ignore_errors=True)
                    lock_dir.mkdir()
                    acquired = True
                except OSError:
                    pass  # lost the steal race, or another racer re-created it
        yield acquired
    finally:
        if acquired:
            shutil.rmtree(lock_dir, ignore_errors=True)


def hub_healthy(hub_port: str, timeout: float = 3.0) -> bool:
    """Probe the hub's health endpoint. True iff it responds 200. Tries HTTPS then
    HTTP (the hub may serve either). Detects a dead hub even when the build is
    current — e.g. after a cgroup kill takes the hub down without a rebuild trigger.
    """
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

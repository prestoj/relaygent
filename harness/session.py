"""Sleep/wake handling using the notification-poller cache file."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime

from config import (
    SEEN_TIMESTAMPS_MAX, SLEEP_DEBOUNCE, SLEEP_POLL_INTERVAL, UPTIME_WARN_THRESHOLD,
    URGENT_NOTIFICATION_TYPES, Timer, log, set_status,
)
from notify_format import format_notifications

NOTIFICATIONS_PORT = os.environ.get("RELAYGENT_NOTIFICATIONS_PORT", "8083")
NOTIFICATIONS_CACHE = "/tmp/relaygent-notifications-cache.json"


@dataclass
class SleepResult:
    """Result of sleep/wake cycle."""
    woken: bool
    wake_message: str = ""


MAX_CACHE_STALE = 60  # Force wake if cache file hasn't updated in this many seconds


def _is_sleep_timeout_reminder(notif: dict) -> bool:
    """Return True if this notification is a sleep() max_minutes timer reminder."""
    return (notif.get("type") == "reminder"
            and notif.get("message", "").startswith("Sleep timeout"))


class SleepManager:
    """Handles sleep polling using cached notification file."""

    def __init__(self, timer: Timer):
        self.timer = timer
        # Ordered dict used as a bounded set (key -> None). dict_keys supports set
        # ops for the membership test; insertion order lets us FIFO-evict the oldest.
        self._seen_timestamps: dict = {}
        self._cache_missing_since: float | None = None
        self._uptime_warned = False

    def _check_notifications(self) -> list:
        """Read cached notifications file. Returns list of NEW pending notifications."""
        try:
            with open(NOTIFICATIONS_CACHE) as f:
                notifications = json.loads(f.read())
        except (FileNotFoundError, json.JSONDecodeError):
            return []

        new_notifications = []
        for notif in notifications:
            ts = self._extract_timestamps(notif)
            if ts - self._seen_timestamps.keys():
                self._seen_timestamps.update((k, None) for k in ts)
                new_notifications.append(notif)
        # Bound the dedup set: FIFO-evict oldest keys past the cap so a long-lived
        # relay session doesn't accumulate them forever (slow leak + slowing polls).
        while len(self._seen_timestamps) > SEEN_TIMESTAMPS_MAX:
            del self._seen_timestamps[next(iter(self._seen_timestamps))]
        return new_notifications

    def _extract_timestamps(self, notif: dict) -> set:
        """Extract dedup keys from a notification."""
        timestamps = {m.get("dedup") or m["timestamp"] for m in notif.get("messages", []) if m.get("timestamp")}
        if notif.get("type") == "reminder":
            timestamps.add(f"reminder-{notif.get('id')}")
        if notif.get("type") == "task" and notif.get("timestamp"):
            timestamps.add(notif["timestamp"])
        source = notif.get("source", "")
        for ch in notif.get("channels", []):
            msgs = ch.get("messages", [])
            if msgs:
                timestamps.update(f"{source}-{m['ts']}" for m in msgs if m.get("ts"))
            else:
                timestamps.add(f"{source}-{ch.get('id', '')}-{ch.get('unread', 0)}")
        if not timestamps and notif.get("type"):
            timestamps.add(f"{notif['type']}-{source}-{notif.get('count', 0)}")

        return timestamps

    def _ack_notification(self, endpoint: str) -> None:
        """Tell notifications server to acknowledge a source (best-effort)."""
        try:
            url = f"http://127.0.0.1:{NOTIFICATIONS_PORT}/notifications/{endpoint}"
            req = urllib.request.Request(url, method="POST", data=b"")
            urllib.request.urlopen(req, timeout=3)
        except (urllib.error.URLError, OSError):
            pass

    def _wait_for_wake(self) -> tuple[bool, list]:
        """Poll cache file for wake condition. Returns (woken, notifications)."""
        set_status("sleeping")
        uptime_h = self.timer.elapsed() / 3600
        log(f"Sleeping, waiting for notifications... (relay uptime {uptime_h:.1f}h)")
        # Observability, not rotation: long-lived relays have historically
        # degraded task-wakes (root cause never found — runbook-wake-bug-followup).
        # Surface uptime so any recurrence is diagnosable from logs; warn once.
        if not self._uptime_warned and self.timer.elapsed() > UPTIME_WARN_THRESHOLD:
            self._uptime_warned = True
            log(f"WARNING: relay process uptime {uptime_h/24:.1f}d exceeds "
                f"{UPTIME_WARN_THRESHOLD // 86400}d. Long-lived relays have "
                "historically stopped waking on 'task' notifications. If scheduled "
                "tasks seem stuck, restart the relay (systemctl --user restart "
                "relaygent-relay.service).")

        while True:
            notifications = self._check_notifications()
            if notifications:
                real = [n for n in notifications if not _is_sleep_timeout_reminder(n)]
                if not real:
                    log("Sleep timeout reminder(s) fired — staying asleep")
                    continue
                # Debounce: collect additional notifications before waking,
                # unless any notification is real-time-urgent (e.g. in-call speech).
                all_real = list(real)
                if any(n.get("type") in URGENT_NOTIFICATION_TYPES for n in real):
                    log(f"Waking immediately on urgent notification ({len(all_real)})")
                    return True, all_real
                debounce_end = time.time() + SLEEP_DEBOUNCE
                while time.time() < debounce_end:
                    time.sleep(SLEEP_POLL_INTERVAL)
                    more = self._check_notifications()
                    more_real = [n for n in more if not _is_sleep_timeout_reminder(n)]
                    all_real.extend(more_real)
                    if any(n.get("type") in URGENT_NOTIFICATION_TYPES for n in more_real):
                        break  # Urgent arrived during debounce — wake now
                log(f"Waking with {len(all_real)} notification(s)")
                return True, all_real

            # Force-wake if cache file is stale or missing (poller may have died)
            try:
                age = time.time() - os.path.getmtime(NOTIFICATIONS_CACHE)
                self._cache_missing_since = None
                if age > MAX_CACHE_STALE:
                    log(f"Notification cache stale ({int(age)}s), force-waking")
                    return True, [{"type": "system", "message":
                        "Notification cache stale — waking to check status."}]
            except OSError:
                if self._cache_missing_since is None:
                    self._cache_missing_since = time.time()
                elif time.time() - self._cache_missing_since > MAX_CACHE_STALE:
                    log("Notification cache missing, force-waking")
                    self._cache_missing_since = None
                    return True, [{"type": "system", "message":
                        "Notification cache missing — poller may not be running."}]

            # wait_for_user timeout — wake so Claude can pick up backlog
            try:
                import json as _json
                wait_file = "/tmp/relaygent-wait-until.json"
                if os.path.exists(wait_file):
                    with open(wait_file) as f:
                        wait_data = _json.load(f)
                    if time.time() * 1000 >= wait_data.get("wake_at", 0):
                        os.remove(wait_file)
                        log(f"wait_for_user timeout ({wait_data.get('max_minutes')} min) — waking for backlog work")
                        return True, [{"type": "system", "message":
                            f"wait_for_user timeout after {wait_data.get('max_minutes')} min — "
                            "user didn't return. Pick up backlog work via get_next_task()."}]
            except (OSError, ValueError, KeyError):
                pass

            if self.timer.is_expired():
                log("Out of time")
                return False, []

            time.sleep(SLEEP_POLL_INTERVAL)

    def auto_sleep_and_wake(self) -> SleepResult:
        """Auto-sleep waiting for any notification. Returns SleepResult."""
        if self.timer.is_expired():
            return SleepResult(woken=False)

        woken, notifications = self._wait_for_wake()
        if not woken:
            return SleepResult(woken=False)

        # Ack notifications so they don't re-trigger on next sleep
        for source, endpoint in [("slack", "ack-slack"), ("github", "ack-github")]:
            if any(n.get("source") == source for n in notifications):
                self._ack_notification(endpoint)

        wake_message = format_notifications(notifications)
        current_time = datetime.now().strftime("%H:%M:%S %Z")
        wake_message += f"\n\nCurrent time: {current_time}"

        set_status("working")
        log("Waking agent...")
        return SleepResult(woken=True, wake_message=wake_message)


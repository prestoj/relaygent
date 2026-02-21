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
    CONTEXT_THRESHOLD, INCOMPLETE_BASE_DELAY, MAX_INCOMPLETE_RETRIES,
    SLEEP_POLL_INTERVAL, Timer, log, set_status,
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
        self._seen_timestamps = set()
        self._cache_missing_since: float | None = None

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
            if ts - self._seen_timestamps:
                self._seen_timestamps.update(ts)
                new_notifications.append(notif)
        return new_notifications

    def _extract_timestamps(self, notif: dict) -> set:
        """Extract dedup keys from a notification."""
        timestamps = {m["timestamp"] for m in notif.get("messages", []) if m.get("timestamp")}
        if notif.get("type") == "reminder":
            timestamps.add(f"reminder-{notif.get('id')}")
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

    def _ack_source(self, source: str) -> None:
        """Tell notifications server to ack a source (slack, github, etc.)."""
        try:
            url = f"http://127.0.0.1:{NOTIFICATIONS_PORT}/notifications/ack-{source}"
            urllib.request.urlopen(urllib.request.Request(url, method="POST", data=b""), timeout=3)
        except (urllib.error.URLError, OSError):
            pass

    def _wait_for_wake(self) -> tuple[bool, list]:
        """Poll cache file for wake condition. Returns (woken, notifications)."""
        set_status("sleeping")
        log("Sleeping, waiting for notifications...")

        while True:
            notifications = self._check_notifications()
            if notifications:
                real = [n for n in notifications if not _is_sleep_timeout_reminder(n)]
                if not real:
                    log("Sleep timeout reminder(s) fired — staying asleep")
                    continue
                log(f"Notification: {real[0].get('type', '?')}")
                return True, real

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
        for src in ("slack", "github"):
            if any(n.get("source") == src for n in notifications):
                self._ack_source(src)

        wake_message = format_notifications(notifications)
        current_time = datetime.now().strftime("%H:%M:%S %Z")
        wake_message += f"\n\nCurrent time: {current_time}"

        set_status("working")
        log("Waking agent...")
        return SleepResult(woken=True, wake_message=wake_message)

    def run_wake_cycle(self, claude):
        """Sleep/wake loop with retry limits. Returns ClaudeResult if context-full."""
        oserror_retries = 0
        while True:
            result = self.auto_sleep_and_wake()
            if not result or not result.woken:
                return None
            time.sleep(3)
            try:
                log_start = claude.resume(result.wake_message)
            except OSError as e:
                oserror_retries += 1
                if oserror_retries > MAX_INCOMPLETE_RETRIES:
                    log(f"Resume failed too many times ({oserror_retries}): {e}")
                    return None
                log(f"Resume failed on wake ({oserror_retries}/{MAX_INCOMPLETE_RETRIES}): {e}, retrying...")
                time.sleep(5)
                continue
            claude_result = claude.monitor(log_start)
            if claude_result.timed_out:
                return None
            wake_retries = 0
            while claude_result.incomplete or claude_result.hung or claude_result.no_output:
                if self.timer.is_expired():
                    return None
                wake_retries += 1
                if wake_retries > MAX_INCOMPLETE_RETRIES:
                    log(f"Too many wake retries ({wake_retries}), giving up on this wake cycle")
                    break
                delay = min(INCOMPLETE_BASE_DELAY * (2 ** (wake_retries - 1)), 60)
                kind = "Hung" if claude_result.hung else ("Incomplete" if claude_result.incomplete else "No output")
                resume_msg = ("An API error was detected. Continue where you left off." if claude_result.hung
                              else "Continue where you left off.")
                log(f"{kind} during wake ({wake_retries}/{MAX_INCOMPLETE_RETRIES}), resuming in {delay}s...")
                time.sleep(delay)
                try: log_start = claude.resume(resume_msg)
                except OSError as e: log(f"Resume failed in wake retry: {e}"); break
                claude_result = claude.monitor(log_start)
                if claude_result.timed_out:
                    return None
            if claude_result.context_too_large:
                log("Request too large or bad image — returning for fresh session")
                return claude_result
            if claude_result.exit_code != 0:
                log(f"Crashed during wake (exit={claude_result.exit_code}), resuming...")
                time.sleep(3)
                log_start = claude.resume("You crashed and were resumed. Continue where you left off.")
                claude_result = claude.monitor(log_start)
            if claude_result.context_pct >= CONTEXT_THRESHOLD:
                return claude_result

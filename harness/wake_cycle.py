"""Wake cycle retry logic — handles sleep/wake with error recovery."""

from __future__ import annotations

import time

from config import (
    CONTEXT_THRESHOLD, INCOMPLETE_BASE_DELAY, MAX_INCOMPLETE_RETRIES, log,
)
from jsonl_images import strip_all_images


def run_wake_cycle(sleep_mgr, claude):
    """Sleep/wake loop with retry limits. Returns ClaudeResult if context-full."""
    oserror_retries = 0
    while True:
        result = sleep_mgr.auto_sleep_and_wake()
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
            if sleep_mgr.timer.is_expired():
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
            try:
                log_start = claude.resume(resume_msg)
            except OSError as e:
                log(f"Resume failed in wake retry: {e}")
                break
            claude_result = claude.monitor(log_start)
            if claude_result.timed_out:
                return None
        if claude_result.bad_image and not claude_result.context_too_large:
            stripped = strip_all_images(claude.session_id, claude.workspace)
            log(f"Bad image during wake — stripped {stripped} images, resuming...")
            time.sleep(3)
            try:
                log_start = claude.resume("A screenshot was corrupted. All images stripped. Continue.")
            except OSError as e:
                log(f"Resume after image strip failed: {e}"); return claude_result
            claude_result = claude.monitor(log_start)
        if claude_result.context_too_large:
            log("Request too large — returning for fresh session")
            return claude_result
        if claude_result.exit_code != 0:
            log(f"Crashed during wake (exit={claude_result.exit_code}), resuming...")
            time.sleep(3)
            log_start = claude.resume("You crashed and were resumed. Continue where you left off.")
            claude_result = claude.monitor(log_start)
        if claude_result.context_pct >= CONTEXT_THRESHOLD:
            return claude_result

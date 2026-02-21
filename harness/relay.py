#!/usr/bin/env python3
"""Relaygent - Autonomous context-based Claude runner."""
from __future__ import annotations

import os
import signal
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import (CONTEXT_THRESHOLD, MAX_IDLE_CONTINUATIONS, SILENCE_TIMEOUT,
                    Timer, cleanup_old_workspaces, get_workspace_dir, log, set_status)
from handoff import validate_and_log
from jsonl_checks import should_sleep, last_output_is_idle
from process import ClaudeProcess
from relay_loop import Action, LoopState, handle_error
from relay_utils import (acquire_lock, cleanup_context_file, cleanup_pid_file,
                         commit_kb, notify_crash, rotate_log, startup_init)
from session import SleepManager
from wake_cycle import run_wake_cycle


class RelayRunner:
    """Main orchestrator for relay Claude runs."""
    def __init__(self):
        self.timer = Timer()
        self.sleep_mgr = SleepManager(self.timer)
        self.claude: ClaudeProcess | None = None

    def _spawn_successor(self, workspace, state, reason):
        """Spawn a successor session."""
        log(f"{reason} ({self.timer.remaining() // 60} min remaining)")
        commit_kb()
        cleanup_context_file()
        state.new_session()
        state.crash_count = state.idle_continuation_count = 0
        self.claude = ClaudeProcess(state.session_id, self.timer, workspace)
        log(f"Successor session: {state.session_id}")
        time.sleep(3)

    def _apply_error(self, err, state):
        """Execute side effects from an error result."""
        if err.log_msg:
            log(err.log_msg)
        if err.status:
            set_status(err.status, session_id=state.session_id)
        if err.should_notify:
            notify_crash(*err.notify_args)
        if err.delay:
            time.sleep(err.delay)
        self.claude.session_id = state.session_id

    def run(self) -> int:
        """Main entry point. Returns exit code."""
        rotate_log()
        cleanup_context_file()
        workspace = get_workspace_dir()
        log(f"Workspace: {workspace}")
        cleanup_old_workspaces(days=7)

        timestamp_file = Path(__file__).parent / ".last_run_timestamp"
        timestamp_file.write_text(str(int(self.timer.start_time)))

        state = LoopState(session_id=str(uuid.uuid4()))
        log(f"Starting relay run (session: {state.session_id})")
        self.claude = ClaudeProcess(state.session_id, self.timer, workspace)

        def _shutdown(*_):
            set_status("off")
            if self.claude:
                self.claude._terminate()
            sys.exit(1)
        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)

        while not self.timer.is_expired():
            set_status("working", session_id=state.session_id)
            log_start = (self.claude.resume(state.resume_reason) if state.session_established
                         else self.claude.start_fresh())

            result = self.claude.monitor(log_start)
            if self.timer.is_expired():
                break

            err = handle_error(result, state)
            if err is not None:
                self._apply_error(err, state)
                if err.action == Action.CONTINUE:
                    continue
                break

            if not should_sleep(self.claude.session_id, self.claude.workspace):
                log("Session incomplete (no stdout), resuming...")
                state.session_established = True
                state.resume_reason = (f"Your previous API call failed after {SILENCE_TIMEOUT} seconds. "
                                       f"Please proceed with the original instructions.")
                time.sleep(2)
                continue

            state.session_established = True
            state.reset_counters()

            if result.context_pct >= CONTEXT_THRESHOLD and self.timer.has_successor_time():
                self._spawn_successor(workspace, state,
                    f"Context at {result.context_pct:.0f}%, spawning successor")
                continue

            if (result.context_pct < CONTEXT_THRESHOLD
                    and last_output_is_idle(self.claude.session_id, self.claude.workspace)):
                state.idle_continuation_count += 1
                if state.idle_continuation_count <= MAX_IDLE_CONTINUATIONS:
                    state.resume_reason = (
                        f"Context at {result.context_pct:.0f}% — keep doing useful work "
                        f"until 85%, then write your handoff.")
                    continue
                log(f"Idle output {state.idle_continuation_count} times in a row, going to sleep cycle")
            state.idle_continuation_count = 0
            wake_result = run_wake_cycle(self.sleep_mgr, self.claude)
            if (wake_result and wake_result.context_pct >= CONTEXT_THRESHOLD
                    and self.timer.has_successor_time()):
                self._spawn_successor(workspace, state,
                    f"Context at {wake_result.context_pct:.0f}% after wake")
                continue
            break

        goal = validate_and_log()
        commit_kb()
        set_status("off", goal=goal)
        cleanup_context_file()
        log("Relay run complete")
        return 0


def main() -> int:
    lock_fd = acquire_lock()
    startup_init()
    try:
        return RelayRunner().run()
    finally:
        cleanup_pid_file()
        os.close(lock_fd)


if __name__ == "__main__":
    sys.exit(main())

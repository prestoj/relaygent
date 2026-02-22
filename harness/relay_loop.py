"""Result handling and state for the relay main loop.

Extracted from relay.py to keep it under 200 lines. Contains pure decision
logic — no side effects (logging, sleeping, status updates). The caller
(relay.py) interprets ErrorResult and performs side effects.
"""

import uuid
from dataclasses import dataclass
from enum import Enum, auto

from config import INCOMPLETE_BASE_DELAY, MAX_INCOMPLETE_RETRIES, MAX_RETRIES


class Action(Enum):
    CONTINUE = auto()
    BREAK = auto()


@dataclass
class ErrorResult:
    """Describes what to do after an error — interpreted by relay.py."""
    action: Action
    delay: int = 0
    status: str | None = None
    log_msg: str = ""
    should_notify: bool = False
    notify_args: tuple = ()


@dataclass
class LoopState:
    """Mutable state for the relay main loop."""
    session_id: str
    session_established: bool = False
    resume_reason: str = ""
    crash_count: int = 0
    incomplete_count: int = 0
    idle_continuation_count: int = 0
    no_output_count: int = 0

    def new_session(self):
        """Generate new session ID and reset to fresh start."""
        self.session_id = str(uuid.uuid4())
        self.session_established = False
        self.resume_reason = ""

    def reset_counters(self):
        """Reset error counters after successful completion."""
        self.incomplete_count = 0
        self.crash_count = 0
        self.no_output_count = 0


def handle_error(result, state: LoopState) -> ErrorResult | None:
    """Pure decision logic for error conditions.

    Updates state in-place, returns ErrorResult with side effects to perform,
    or None if no error (success path).
    """
    if result.hung:
        state.session_established = True
        state.resume_reason = ("An API error was detected (no response or repeated failures). "
                               "Please proceed with the original instructions.")
        return ErrorResult(Action.CONTINUE, delay=15, status="crashed", log_msg="Hung, resuming...")

    if result.rate_limited:
        return ErrorResult(Action.CONTINUE, delay=60, status="rate_limited",
                           log_msg="API rate limit — waiting 60s before retry")

    if result.no_output:
        state.no_output_count += 1
        if state.no_output_count > MAX_INCOMPLETE_RETRIES:
            return ErrorResult(Action.BREAK, should_notify=True,
                               notify_args=(state.no_output_count, 0),
                               log_msg=f"Too many no-output exits ({state.no_output_count}), giving up")
        delay = min(INCOMPLETE_BASE_DELAY * (2 ** (state.no_output_count - 1)), 60)
        if state.session_established:
            log_msg = f"Resume failed ({state.no_output_count}/{MAX_INCOMPLETE_RETRIES}), starting fresh..."
            state.new_session()
            return ErrorResult(Action.CONTINUE, delay=delay, log_msg=log_msg)
        state.session_established = True
        state.resume_reason = "Your previous session exited without output. Please proceed."
        return ErrorResult(Action.CONTINUE, delay=delay,
                           log_msg=f"No output ({state.no_output_count}/{MAX_INCOMPLETE_RETRIES}), "
                                   f"retrying in {delay}s...")

    if result.bad_image and not result.context_too_large:
        state.session_established = True
        state.resume_reason = ("A screenshot was corrupted and the API rejected it. "
                               "All images have been stripped from your history. Continue where you left off.")
        return ErrorResult(Action.CONTINUE, delay=5,
                           log_msg="Bad image — stripped all images, resuming session")

    if result.context_too_large:
        state.new_session()
        state.incomplete_count = 0
        return ErrorResult(Action.CONTINUE, delay=5,
                           log_msg="Request too large — starting fresh session")

    if result.incomplete:
        state.incomplete_count += 1
        if state.incomplete_count > MAX_INCOMPLETE_RETRIES:
            count = state.incomplete_count
            state.new_session()
            state.incomplete_count = 0
            return ErrorResult(Action.CONTINUE, delay=15,
                               log_msg=f"Too many incomplete exits ({count}), starting fresh session...")
        delay = min(INCOMPLETE_BASE_DELAY * (2 ** (state.incomplete_count - 1)), 60)
        state.session_established = True
        state.resume_reason = "Continue where you left off."
        return ErrorResult(Action.CONTINUE, delay=delay,
                           log_msg=f"Exited mid-conversation ({state.incomplete_count}/"
                                   f"{MAX_INCOMPLETE_RETRIES}), resuming in {delay}s...")

    if result.exit_code != 0:
        state.crash_count += 1
        if state.crash_count > MAX_RETRIES:
            return ErrorResult(Action.BREAK, status="crashed", should_notify=True,
                               notify_args=(state.crash_count, result.exit_code),
                               log_msg=f"Too many crashes ({state.crash_count}), giving up")
        state.new_session()
        return ErrorResult(Action.CONTINUE, delay=15, status="crashed",
                           log_msg=f"Crashed (exit={result.exit_code}), "
                                   f"retrying ({state.crash_count}/{MAX_RETRIES})...")

    return None

"""Tests for API error handling in relay_loop.py."""
from __future__ import annotations

from config import MAX_API_ERROR_RETRIES
from process import ClaudeResult
from relay_loop import Action, LoopState, handle_error


def _result(**kwargs) -> ClaudeResult:
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_too_large=False,
                    bad_image=False, rate_limited=False, api_error=False,
                    context_pct=0.0)
    return ClaudeResult(**{**defaults, **kwargs})


class TestApiError:
    def test_first_api_error_retries(self):
        state = LoopState(session_id="x", session_established=True)
        err = handle_error(_result(exit_code=1, api_error=True), state)
        assert err.action == Action.CONTINUE
        assert err.delay == 15  # 15 * 2^0
        assert err.status == "api_error"
        assert state.api_error_count == 1
        assert state.session_id == "x"  # NOT a new session

    def test_api_error_resumes_established_session(self):
        state = LoopState(session_id="x", session_established=True)
        handle_error(_result(exit_code=1, api_error=True), state)
        assert "server error" in state.resume_reason.lower()
        assert state.session_established is True

    def test_api_error_on_fresh_session_no_resume_reason(self):
        state = LoopState(session_id="x", session_established=False)
        handle_error(_result(exit_code=1, api_error=True), state)
        assert state.resume_reason == ""
        assert state.session_established is False

    def test_api_error_exponential_backoff(self):
        state = LoopState(session_id="x", api_error_count=2)
        err = handle_error(_result(exit_code=1, api_error=True), state)
        assert err.delay == min(15 * (2 ** 2), 120)  # 60s

    def test_api_error_backoff_caps_at_120s(self):
        state = LoopState(session_id="x", api_error_count=5)
        err = handle_error(_result(exit_code=1, api_error=True), state)
        assert err.delay == 120

    def test_api_error_does_not_increment_crash_count(self):
        state = LoopState(session_id="x", crash_count=0)
        handle_error(_result(exit_code=1, api_error=True), state)
        assert state.crash_count == 0

    def test_api_error_exceeds_max_starts_fresh(self):
        state = LoopState(session_id="old", api_error_count=MAX_API_ERROR_RETRIES)
        err = handle_error(_result(exit_code=1, api_error=True), state)
        assert err.action == Action.CONTINUE  # NOT break — just fresh session
        assert state.session_id != "old"
        assert state.api_error_count == 0

    def test_api_error_at_max_still_retries(self):
        state = LoopState(session_id="x", api_error_count=MAX_API_ERROR_RETRIES - 1)
        err = handle_error(_result(exit_code=1, api_error=True), state)
        assert err.action == Action.CONTINUE
        assert state.api_error_count == MAX_API_ERROR_RETRIES

    def test_api_error_with_exit_0_ignored(self):
        """API error flag with clean exit should not trigger handler."""
        state = LoopState(session_id="x")
        err = handle_error(_result(exit_code=0, api_error=True), state)
        assert err is None

    def test_reset_counters_clears_api_error_count(self):
        state = LoopState(session_id="x", api_error_count=5)
        state.reset_counters()
        assert state.api_error_count == 0

    def test_api_error_never_breaks(self):
        """Even after exceeding max, API errors start fresh — never give up."""
        state = LoopState(session_id="x", api_error_count=MAX_API_ERROR_RETRIES)
        err = handle_error(_result(exit_code=1, api_error=True), state)
        assert err.action == Action.CONTINUE
        assert err.should_notify is False
